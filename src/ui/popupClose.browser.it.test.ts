// FUNCTIONAL: a form inside the app popup answers with an empty body + HX-Retarget "#app-popup-body"
// + a toast; popup.js must close the dialog (htmx leaves ctx.target as the selector string) and the toast shows.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
const ctx = await mkTestCtx();
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    const htmx = await Bun.file(new URL("../../node_modules/htmx.org/dist/htmx.js", import.meta.url)).text();
    const popup = await Bun.file(new URL("./$script_popup.js", import.meta.url)).text();
    const control = await ctx.fns.ui.controlScript({});
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/htmx.js") return new Response(htmx, { headers: { "content-type": "text/javascript" } });
        if (path === "/control.js") return new Response(control, { headers: { "content-type": "text/javascript" } });
        if (path === "/popup.js") return new Response(popup, { headers: { "content-type": "text/javascript" } });
        if (path === "/act") { const r = ctx.fns.w.respond({ toast: { message: "Отправлено исполнителю" } }); const h = new Headers(r.headers); h.set("HX-Retarget", "#app-popup-body"); h.set("HX-Reswap", "innerHTML"); return new Response("", { headers: h }); }
        return new Response(`<!doctype html><meta charset="utf-8"><body><dialog id="app-popup"><div><h2 id="app-popup-title"></h2><div id="app-popup-body"><div id="card"><form hx-post="/act" hx-target="#card" hx-swap="outerHTML"><button id="go">Принять</button></form></div></div></div></dialog>
<script>window.hyperLive={subscribe(){}}</script><script src="/htmx.js"></script><script src="/control.js"></script><script src="/popup.js"></script></body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    } });
});
afterAll(() => server?.stop(true));

test.skipIf(!CDP)("empty retargeted answer closes the popup and shows the toast", async () => {
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let id = 0; const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const ev = (expression: string) => new Promise<any>((ok) => { pending.set(++id, (m) => ok(m.result?.result?.value ?? m.result?.exceptionDetails?.text)); ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
    try {
        for (let i = 0; i < 100 && !(await ev("!!(window.htmx && window.hyperPopup && document.getElementById('go'))")); i++) await Bun.sleep(50);
        await ev("window.hyperPopup.open('Задача', 'file-preview')");
        const seen = await ev(`new Promise((done) => { document.getElementById('go').click(); const t0 = Date.now();
            (function poll() { const open = document.getElementById('app-popup').open; const toast = [...document.querySelectorAll('#toasts > div')].map(n => n.textContent).join('|');
              if ((!open && toast) || Date.now() - t0 > 3000) done({ open, toast }); else setTimeout(poll, 30); })(); })`);
        expect(seen.open).toBe(false);
        expect(seen.toast).toContain("Отправлено исполнителю");
    } finally { ws.close(); await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {}); }
}, 15000);
