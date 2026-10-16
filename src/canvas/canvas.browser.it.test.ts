// FUNCTIONAL test in a real (headless) Chrome: the agent opens a canvas while the person's tab is in the
// background. A hidden tab has no event stream (procs/events/client.js drops it), so the canvas.changed
// event never reaches it; canvas.js must catch up when the tab is shown again. Before the fix the canvas
// stayed closed. Runs in the suite's headless Chrome (test/chrome/headless.ts); skipped without Chrome.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
const ctx: any = await mkTestCtx();
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    await ctx.fns.procs.http.loadRoutes({});
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 60, fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }) });
});
afterAll(() => server?.stop(true));

async function openTab(url: string) {
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let id = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const evaluate = (expression: string) => new Promise<any>((ok) => {
        pending.set(++id, (m) => ok(m.result?.result?.value));
        ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
    const close = async () => { ws.close(); await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null); };
    return { evaluate, close };
}

const canvasState = `(() => { const r = document.querySelector('[data-canvas-agent]'); return { open: !!r?.hasAttribute('data-canvas-open'), tabs: r?.querySelectorAll('[data-canvas-tab]').length ?? -1 }; })()`;
// Chrome's own hidden state cannot be forced on a headless tab, so the page is told it is hidden the way
// the browser does it: visibilityState plus a visibilitychange event (events/client.js then drops its stream).
const setVisibility = (state: "hidden" | "visible") => `Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => '${state}' }); document.dispatchEvent(new Event('visibilitychange')); true`;

test.skipIf(!CDP)("a canvas the agent opened while the tab was hidden opens when the tab is shown again", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const tab = await openTab(`http://127.0.0.1:${server.port}/agent/${agent.id}`);
    try {
        for (let i = 0; i < 100 && !(await tab.evaluate("!!(window.__hyperCanvasInstalled && window.__hyperEventsInstalled && document.querySelector('[data-canvas-agent]'))")); i++) await Bun.sleep(50);
        expect(await tab.evaluate(canvasState)).toEqual({ open: false, tabs: 0 });

        await tab.evaluate(setVisibility("hidden"));
        await ctx.fns.canvas.show({ agentId: agent.id, kind: "html", title: "Drawing", args: { html: "<p>drawing</p>" } });
        await Bun.sleep(300);
        expect((await tab.evaluate(canvasState)).open).toBe(false);   // hidden: no stream, nothing arrived

        await tab.evaluate(setVisibility("visible"));
        let state: any = null;
        for (let i = 0; i < 60; i++) { state = await tab.evaluate(canvasState); if (state.open && state.tabs === 1) break; await Bun.sleep(50); }
        expect(state).toEqual({ open: true, tabs: 1 });
    } finally {
        await tab.close();
    }
}, 30_000);
