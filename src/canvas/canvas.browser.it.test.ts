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

// The canvas sheet under a key of this run: styles.build otherwise serves the sheet a previous process left
// (and rebuilds in the background), so a rule added since would be missing here; the server's file stays its own.
let sheet = "";
beforeAll(async () => {
    await ctx.fns.procs.http.loadRoutes({});
    const style = (ctx.state.procs.styles ?? []).find((s: any) => s.href === "/canvas/canvas.css");
    if (CDP && style) { style.key = `${style.key}_it_${process.pid}`; sheet = await ctx.fns.procs.styles.build({ abs: style.abs, key: style.key, force: true }); }
    // No background rebuild of every sheet from the first page load: it would outlive this file and leave half-written files.
    (ctx.state.procs as any).stylesBootRebuild = true;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 60, fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }) });
});
afterAll(async () => {
    server?.stop(true);
    if (sheet) for (const file of [sheet, sheet.replace(/\.css$/, ".in.css")]) await Bun.file(file).delete().catch(() => undefined);
});

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
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { pending.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
    const close = async () => { ws.close(); await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null); };
    return { evaluate, send, close };
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

// The folded chat (canvas_state.chat_collapsed) is a strip over the canvas with its own unfold button. The
// button's CSS was dropped with the old canvas header styles, so it stayed `hidden` and the strip had no way
// back of its own. Fold → reload → unfold from the strip; the column comes back at its saved width.
const foldState = `(() => {
    const root = document.querySelector('[data-canvas-agent]'), chat = document.getElementById('chat-panel');
    const button = chat.querySelector('[data-canvas-chat-toggle]'), box = button.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
        collapsed: root.hasAttribute('data-chat-collapsed'), chatWidth: Math.round(chat.getBoundingClientRect().width),
        button: box.width > 0 && !!hit && button.contains(hit),
        icons: [...button.querySelectorAll('i')].filter(i => getComputedStyle(i).display !== 'none').map(i => i.classList.contains('canvas-chat-unfold') ? 'unfold' : 'fold'),
    };
})()`;

test.skipIf(!CDP)("the folded chat strip has its own unfold button; fold and unfold keep the chat width, a reload keeps the fold", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.canvas.show({ agentId: agent.id, kind: "html", title: "Drawing", args: { html: "<p>drawing</p>" } });
    await ctx.fns.canvas.update({ agentId: agent.id, chatWidth: 520 });
    const tab = await openTab(`http://127.0.0.1:${server.port}/agent/${agent.id}`);
    const ready = async () => { for (let i = 0; i < 100 && !(await tab.evaluate("!!(window.__hyperCanvasInstalled && window.htmx && window.hyperCommands?.['canvas.toggleChat'] && document.querySelector('[data-canvas-agent] #chat-panel [data-canvas-chat-toggle]'))")); i++) await Bun.sleep(50); };
    const until = async (collapsed: boolean) => { let state: any = null; for (let i = 0; i < 60; i++) { state = await tab.evaluate(foldState); if (state?.collapsed === collapsed) break; await Bun.sleep(50); } return state; };
    try {
        await tab.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
        await ready();
        expect(await until(false)).toMatchObject({ collapsed: false, chatWidth: 520 });

        expect(await tab.evaluate("window.hyperCommands['canvas.toggleChat'].run()")).toBe(true);
        expect(await until(true)).toMatchObject({ collapsed: true, button: true, icons: ["unfold"] });
        expect(await ctx.fns.canvas.get({ agentId: agent.id })).toMatchObject({ open: true, chatCollapsed: true, chatWidth: 520 });

        await tab.evaluate("location.reload()");
        await Bun.sleep(300);
        await ready();
        expect(await until(true)).toMatchObject({ collapsed: true, button: true, icons: ["unfold"] });

        await tab.evaluate("document.querySelector('#chat-panel [data-canvas-chat-toggle]').click()");
        expect(await until(false)).toMatchObject({ collapsed: false, chatWidth: 520 });
        expect(await ctx.fns.canvas.get({ agentId: agent.id })).toMatchObject({ open: true, chatCollapsed: false, chatWidth: 520 });
    } finally {
        await tab.close();
    }
}, 30_000);

// Below 1024px the canvas covers the whole page (ui.layout, z-index 45). The folded strip sat under it at 44 —
// the chat was gone from the screen. At every narrow width the strip is on top and inside the window.
const stripState = `(() => {
    const chat = document.getElementById('chat-panel'), box = chat.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const un = chat.querySelector('[data-canvas-chat-toggle]').getBoundingClientRect(), unHit = document.elementFromPoint(un.left + un.width / 2, un.top + un.height / 2);
    return { collapsed: document.querySelector('[data-canvas-agent]').hasAttribute('data-chat-collapsed'), onTop: !!hit && chat.contains(hit), unfold: un.width > 0 && !!unHit?.closest('#chat-panel [data-canvas-chat-toggle]'), inside: box.width > 200 && box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight };
})()`;

test.skipIf(!CDP)("in a narrow window the folded chat strip stays over the canvas", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.canvas.show({ agentId: agent.id, kind: "html", title: "Drawing", args: { html: "<p>drawing</p>" } });
    await ctx.fns.canvas.update({ agentId: agent.id, chatCollapsed: true });
    const tab = await openTab(`http://127.0.0.1:${server.port}/agent/${agent.id}`);
    try {
        for (const width of [1400, 1000, 800, 600, 390]) {
            await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            let state: any = null;
            for (let i = 0; i < 60; i++) { state = await tab.evaluate(`window.__hyperCanvasInstalled && document.getElementById('chat-panel') ? ${stripState} : null`); if (state?.collapsed && state.onTop && state.unfold) break; await Bun.sleep(50); }
            expect({ width, ...state }).toEqual({ width, collapsed: true, onTop: true, unfold: true, inside: true });
        }
        // A strip dragged to the right in a wide window comes back inside when the window gets narrow.
        await tab.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
        await tab.evaluate("localStorage.setItem('hyper-strip-pos', JSON.stringify({ x: 700, y: 300 })); location.reload()");
        await Bun.sleep(300);
        for (const width of [1400, 700]) {
            await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            let state: any = null;
            for (let i = 0; i < 60; i++) { state = await tab.evaluate(`window.__hyperCanvasInstalled && document.getElementById('chat-panel')?.hasAttribute('data-strip-moved') ? ${stripState} : null`); if (state?.onTop && state.inside) break; await Bun.sleep(50); }
            expect({ moved: width, ...state }).toEqual({ moved: width, collapsed: true, onTop: true, unfold: true, inside: true });
        }
    } finally {
        await tab.close();
    }
}, 30_000);
