// FUNCTIONAL test in a real Chrome: a Russian toast goes through the whole chain
// a user hits — procs.ui.respond puts it in HX-Trigger, real htmx 4 reads the
// header and fires `hyper-toast`, the real ui.controlScript shows the toast.
// Before the fix `new Response` threw on the Cyrillic header: 500, no toast.
// Needs Chrome with CDP on CDP_BROWSER_URL (default :9222); skipped otherwise.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../../_testCtx.entry";

const CDP = process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9222";
const available = await fetch(`${CDP}/json/version`).then((r) => r.ok, () => false);

const ctx = await mkTestCtx();
let server: ReturnType<typeof Bun.serve>;
let toast = { message: "", level: "info" as "info" | "success" };

beforeAll(async () => {
    const htmx = await Bun.file(new URL("../../../node_modules/htmx.org/dist/htmx.js", import.meta.url)).text();
    const control = await ctx.fns.ui.controlScript({});
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(req) {
            const path = new URL(req.url).pathname;
            if (path === "/htmx.js") return new Response(htmx, { headers: { "content-type": "text/javascript" } });
            if (path === "/control.js") return new Response(control, { headers: { "content-type": "text/javascript" } });
            if (path === "/act") return ctx.fns.procs.ui.respond({ toast });
            return new Response(`<!doctype html><meta charset="utf-8"><body><button id="go" hx-post="/act" hx-swap="none">Сохранить</button>
<script src="/htmx.js"></script><script src="/control.js"></script></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
        },
    });
});
afterAll(() => server?.stop(true));

/** Opens a background tab, clicks the button, returns the toast text and the action's HTTP status. */
async function clickInChrome(): Promise<{ toast: string; status: number }> {
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let id = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const evaluate = (expression: string) => new Promise<any>((ok) => {
        pending.set(++id, (m) => ok(m.result?.result?.value));
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    try {
        for (let i = 0; i < 100 && !(await evaluate("!!(window.htmx && window.__hyperUiControlInstalled && document.getElementById('go'))")); i++) await Bun.sleep(50);
        return await evaluate(`new Promise((done) => {
            let status = 0;
            document.body.addEventListener('htmx:after:request', (e) => { status = e.detail?.ctx?.response?.status ?? status; });
            document.getElementById('go').click();
            const t0 = Date.now();
            (function poll() {
                const text = [...document.querySelectorAll('#toasts > div')].map((n) => n.textContent).join(' | ');
                if (text || Date.now() - t0 > 3000) done({ toast: text, status });
                else setTimeout(poll, 30);
            })();
        })`);
    } finally {
        ws.close();
        await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
    }
}

test.skipIf(!available)("a Russian toast with emoji shows in Chrome as the same text", async () => {
    toast = { message: "Статус обновлён ✅ «готово»", level: "success" };
    const seen = await clickInChrome();
    expect(seen.status).toBe(200);
    expect(seen.toast).toContain("Статус обновлён ✅ «готово»");
}, 15000);

test.skipIf(!available)("an English toast is unchanged", async () => {
    toast = { message: "Task created", level: "info" };
    expect((await clickInChrome()).toast).toContain("Task created");
}, 15000);
