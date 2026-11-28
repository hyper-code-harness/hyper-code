// Real native-popover, production-CSS and live-route regression in the test Chrome.
// No provider I/O, credentials, developer browser, or production DB are used.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
let ctx: any;
let server: ReturnType<typeof Bun.serve>;
let requests = 0;
let used = 78;
let reads = 0;
const sheets = new Map<string, string>();
const resetsAt = Date.now() + 7_200_000;

beforeAll(async () => {
    if (!CDP) return;
    ctx = await mkTestCtx();
    await ctx.fns.procs.http.loadRoutes({});
    ctx.state.registry.llm.usageOverview = async () => {
        reads++;
        return [{ provider: "codex", account: "work", label: "codex · work", model: "codex:", usedPercent: used, resetsAt, planType: "pro", parkedAgents: 0, tone: "error" }];
    };
    ctx.state.registry.llm.refreshUsage = async () => [];
    ctx.state.dock.items = { "llms.usage": ctx.state.dock.items["llms.usage"] };
    for (const [name, source] of [["app", "../procs/styles/$style_app.css"], ["w", "../w/$style_w.css"], ["dock", "../dock/$style_dock.css"]]) {
        sheets.set(`/css/${name}.css`, await ctx.fns.procs.styles.build({ abs: join(import.meta.dir, source!), key: `usage-browser-${process.pid}-${Date.now()}-${name}`, force: true }));
    }
    ctx.state.procs.stylesBootRebuild = true;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 60, fetch: async (req, srv) => {
        const path = new URL(req.url).pathname;
        if (sheets.has(path)) return new Response(Bun.file(sheets.get(path)!));
        if (path === "/fixture") return new Response(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/w.css"><link rel="stylesheet" href="/css/dock.css"><script src="/procs/ui/htmx.js" defer></script><style>body{display:flex;height:100dvh;margin:0}</style></head><body>${await ctx.fns.dock.render({})}<main>Quota fixture</main></body></html>`, { headers: { "content-type": "text/html" } });
        if (path === "/llms/usage") requests++;
        return ctx.fns.procs.http.handle({ req, server: srv });
    } });
});

afterAll(async () => {
    server?.stop(true);
    for (const file of [...sheets.values()].flatMap(path => [path, path.replace(/\.css$/, ".in.css")])) await Bun.file(file).delete().catch(() => undefined);
});

test.skipIf(!CDP)("a neutral Dock ring opens readable reset details with pointer or keyboard and marks real exhaustion", async () => {
    const tab: any = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let nextId = 0;
    const pending = new Map<number, (value: any) => void>();
    ws.onmessage = (event) => { const value = JSON.parse(String(event.data)); const resolve = pending.get(value.id); pending.delete(value.id); resolve?.(value); };
    const send = (method: string, params: Record<string, any> = {}) => new Promise<any>((resolve) => { const id = ++nextId; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression: string) => {
        const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails));
        return result.result?.result?.value;
    };
    const waitFor = async (expression: string) => {
        for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await Bun.sleep(20); }
        throw new Error(`Browser condition timed out: ${expression}`);
    };
    const click = async () => {
        const point = await evaluate(`(() => { const r=document.querySelector('[data-usage-indicator]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
    };
    const key = async (key: string, code: string, windowsVirtualKeyCode: number) => {
        await send("Input.dispatchKeyEvent", { type: key === "Enter" ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : {}) });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    };
    try {
        await send("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
        await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/fixture` });
        await waitFor(`document.querySelector('#llm-usage[hx-trigger="hyper-live, every 60s"] .w-ring') !== null`);
        expect(await evaluate(`document.querySelector('.w-ring').dataset.tone`)).toBe("neutral");
        expect(await evaluate(`getComputedStyle(document.querySelector('[data-dock-id="llms.usage"]')).display`)).not.toBe("none");
        expect(await evaluate(`document.querySelector('[data-usage-indicator]').title`)).toContain("78% used");
        expect(await evaluate(`document.querySelector('[data-usage-indicator]').title`)).toContain("resets in");
        expect(await evaluate(`document.querySelector('[data-usage-indicator]').innerText`)).toBe("");
        await click();
        await waitFor(`document.querySelector('#llm-usage-popup').matches(':popover-open')`);
        expect(await evaluate(`document.querySelector('#llm-usage-popup').innerText`)).toContain("78% used");
        expect(await evaluate(`document.querySelector('#llm-usage-popup').innerText`)).toContain("resets in");
        expect(await evaluate(`getComputedStyle(document.querySelector('#llm-usage-popup dd:last-child')).whiteSpace`)).toBe("normal");
        const bounds = await evaluate(`(() => { const p=document.querySelector('#llm-usage-popup');const r=p.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,top:r.top,scroll:p.scrollWidth,width:p.clientWidth}; })()`);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(800);
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(600);
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
        await key("Escape", "Escape", 27);
        await waitFor(`!document.querySelector('#llm-usage-popup').matches(':popover-open')`);
        await evaluate(`document.querySelector('[data-usage-indicator]').focus()`);
        await key("Enter", "Enter", 13);
        await waitFor(`document.querySelector('#llm-usage-popup').matches(':popover-open')`);
        if (process.env.USAGE_SHOT) {
            const shot = await send("Page.captureScreenshot", { format: "png" });
            await Bun.write(process.env.USAGE_SHOT, Buffer.from(shot.result.data, "base64"));
        }
        const beforeOpenRefresh = requests;
        used = 100;
        await evaluate(`document.querySelector('#llm-usage').dispatchEvent(new CustomEvent('hyper-live'))`);
        await Bun.sleep(150);
        expect(requests).toBe(beforeOpenRefresh);
        expect(await evaluate(`document.querySelector('#llm-usage-popup').matches(':popover-open')`)).toBe(true);
        expect(await evaluate(`document.querySelector('.w-ring').dataset.tone`)).toBe("neutral");
        // Also prevent an in-flight response from replacing an already opened panel.
        expect(await evaluate(`(() => { const el=document.querySelector('#llm-usage'); const e=new CustomEvent('htmx:before:swap',{cancelable:true});el.dispatchEvent(e);return e.defaultPrevented; })()`)).toBe(true);
        await key("Escape", "Escape", 27);
        await evaluate(`document.querySelector('#llm-usage').dispatchEvent(new CustomEvent('hyper-live'))`);
        await waitFor(`document.querySelector('.w-ring')?.dataset.tone==='danger'`);
        expect(await evaluate(`document.querySelector('[data-usage-indicator]').title`)).toContain("quota exhausted");
        expect(requests).toBeGreaterThanOrEqual(2);
    } finally {
        ws.close();
        await fetch(`${CDP}/json/close/${tab.id}`);
    }
}, 30_000);

test.skipIf(!CDP)("the existing usage endpoint still rejects unauthenticated requests before reading account details", async () => {
    const previous = ctx.state.registry.auth.currentUser;
    ctx.state.registry.auth.currentUser = async () => ({ user: null, required: true });
    const before = reads;
    try {
        const response = await fetch(`http://127.0.0.1:${server.port}/llms/usage`, { headers: { accept: "application/json" } });
        expect(response.status).toBe(401);
        expect(reads).toBe(before);
        expect(await response.text()).not.toContain("codex");
    } finally { ctx.state.registry.auth.currentUser = previous; }
});
