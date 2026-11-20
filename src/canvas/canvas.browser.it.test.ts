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

// The folded chat (canvas_state.chat_collapsed): the canvas takes the page and the chat is a circle in its bottom
// right corner; the message box opens from it on focus (a click, ⌘I), bubbles float above it.
const foldState = `(() => {
    const root = document.querySelector('[data-canvas-agent]'), chat = document.getElementById('chat-panel'), form = document.getElementById('form');
    const box = form.getBoundingClientRect(), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    const shown = sel => [...chat.querySelectorAll(sel)].filter(el => getComputedStyle(el).display !== 'none');
    const unfold = chat.querySelector('[data-canvas-chat-toggle]').getBoundingClientRect();
    return {
        collapsed: root.hasAttribute('data-chat-collapsed'), open: root.hasAttribute('data-chat-open'),
        size: [Math.round(box.width), Math.round(box.height)], onTop: !!hit && form.contains(hit),
        inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        focused: document.activeElement?.id === 'input', text: document.getElementById('input').value,
        key: getComputedStyle(form.querySelector('.w-composer-box'), '::after').content,
        bubbles: shown('#messages > .w-msg').map(el => el.dataset.role), unread: form.getAttribute('data-unread'),
        tool: shown('#messages > .chat-tools').map(el => el.querySelector('.w-tool[data-running]')?.dataset.label ?? '').join('|'),
        chatWidth: Math.round(chat.getBoundingClientRect().width),
        at: { circle: [box.left + box.width / 2, box.top + box.height / 2], unfold: [unfold.left + unfold.width / 2, unfold.top + unfold.height / 2] },
    };
})()`;
async function foldedTab(agentId: string) {
    const tab = await openTab(`http://127.0.0.1:${server.port}/agent/${agentId}`);
    await tab.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await tab.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    const ready = async () => { for (let i = 0; i < 200 && !(await tab.evaluate("!!(window.__hyperCanvasInstalled && window.htmx && window.hyperKeys && window.hyperCommands?.['chat.focus'] && document.querySelector('[data-canvas-agent] #form'))")); i++) await Bun.sleep(50); };
    const state = () => tab.evaluate(foldState);
    // Polls until the state matches, then asserts it (the page follows the server through events).
    const settle = async (want: Record<string, unknown>) => { let now: any = null; for (let i = 0; i < 60; i++) { now = await state(); if (now && Object.entries(want).every(([k, v]) => JSON.stringify(now[k]) === JSON.stringify(v))) break; await Bun.sleep(50); } expect(now).toMatchObject(want); return now; };
    const click = async ([x, y]: number[]) => { for (const type of ["mousePressed", "mouseReleased"]) await tab.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
    // The chord bound to chat.focus in the default keymap, Mod-i: ⌘I on a Mac, Ctrl+I elsewhere.
    const mac = await tab.evaluate("/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)");
    const focusKey = async () => { for (const type of ["rawKeyDown", "keyUp"]) await tab.send("Input.dispatchKeyEvent", { type, key: "i", code: "KeyI", windowsVirtualKeyCode: 73, modifiers: mac ? 4 : 2 }); };
    const key = async (k: string, code: string, vk: number, text?: string) => { await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }); await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
    // Entering a chat focuses its message box, so a folded chat arrives with the field open; Escape leaves the
    // box and an empty one folds back into the circle.
    const rest = async () => { await settle({ collapsed: true, open: true, focused: true }); await key("Escape", "Escape", 27); return settle({ collapsed: true, open: false, focused: false }); };
    await ready();
    return { ...tab, ready, state, settle, click, key, focusKey, rest, keyLabel: mac ? "⌘I" : "Ctrl+I" };
}

test.skipIf(!CDP)("the folded chat is a circle; a click or the focus key opens the message box, a draft keeps it open, the field unfolds the chat", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    await ctx.fns.canvas.show({ agentId: agent.id, kind: "html", title: "Drawing", args: { html: "<p>drawing</p>" } });
    await ctx.fns.canvas.update({ agentId: agent.id, chatWidth: 520, chatCollapsed: true });
    const tab = await foldedTab(agent.id);
    try {
        // Entering the chat puts the caret in the message box: the field is open, inside the window, ready to type.
        await tab.settle({ collapsed: true, open: true, focused: true, text: "", inside: true });
        await tab.rest();
        // At rest: the circle, with the key that opens the box written beside it.
        const rest = await tab.settle({ collapsed: true, open: false, size: [44, 44], onTop: true, inside: true, focused: false, key: JSON.stringify(tab.keyLabel) });

        // The key goes to the message box; what is typed there stays text, "i" included.
        await tab.focusKey();
        await tab.settle({ open: true, focused: true, text: "", inside: true, key: "none" });
        await tab.key("i", "KeyI", 73, "i");
        await tab.settle({ open: true, focused: true, text: "i" });
        // Escape leaves the box: a draft keeps the field open, an empty box folds back into the circle.
        await tab.key("Escape", "Escape", 27);
        await tab.settle({ open: true, focused: false, text: "i" });
        // The key works from inside a text field too — here back into the box with the draft.
        await tab.focusKey();
        await tab.settle({ open: true, focused: true, text: "i" });
        await tab.key("Escape", "Escape", 27);
        await tab.evaluate("(() => { const i = document.getElementById('input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
        await tab.settle({ open: false, size: [44, 44] });

        // A click on the circle opens the field; its unfold button (a real press, the box keeps the focus) brings the column back.
        await tab.click(rest.at.circle);
        const open = await tab.settle({ open: true, focused: true });
        await tab.click(open.at.unfold);
        await tab.settle({ collapsed: false, open: false, chatWidth: 520 });
        expect(await ctx.fns.canvas.get({ agentId: agent.id })).toMatchObject({ open: true, chatCollapsed: false, chatWidth: 520 });

        // Folded again, a reload keeps it: still the circle, at every width over the canvas and inside the window.
        expect(await tab.evaluate("window.hyperCommands['canvas.toggleChat'].run()")).toBe(true);
        await tab.settle({ collapsed: true });
        await tab.evaluate("document.activeElement?.blur(); location.reload()");
        await Bun.sleep(300);
        await tab.ready();
        await tab.rest();
        for (const width of [1400, 1000, 800, 600, 390]) {
            await tab.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
            await tab.settle({ collapsed: true, open: false, size: [44, 44], onTop: true, inside: true });
        }
        await tab.focusKey();
        await tab.settle({ open: true, focused: true, inside: true });
    } finally {
        await tab.close();
    }
}, 60_000);

test.skipIf(!CDP)("the folded chat shows the latest answer as a bubble with a close cross, counts new answers on the circle and names the running tool", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const id = agent.id;
    let messageIdx = 100;
    const answer = (text: string) => ctx.fns.session.appendAssistantEvent({ id, payload: { text, html: `<p>${text}</p>`, messageIdx: messageIdx++ } });
    await ctx.fns.canvas.show({ agentId: id, kind: "html", title: "Drawing", args: { html: "<p>drawing</p>" } });
    await ctx.fns.session.appendUserMessage({ id, text: "build the table" });
    await answer("Done: the table is built.");
    await ctx.fns.canvas.update({ agentId: id, chatCollapsed: true });
    const tab = await foldedTab(id);
    const runs: Map<string, unknown> = ((ctx.state as any).toolRuns ??= new Map());
    try {
        await tab.rest();
        await tab.settle({ collapsed: true, open: false, bubbles: ["agent"], unread: null, tool: "" });
        // The answer is shown whole — nothing cut, no fade; a very long one scrolls inside its bubble instead.
        const whole = `(() => { const t = [...document.querySelectorAll('#messages > .w-msg[data-role="agent"] .w-msg-text')].pop(), b = t.closest('.w-msg').getBoundingClientRect(); return { cut: t.scrollHeight - t.clientHeight > 1, mask: getComputedStyle(t).maskImage, scrolls: getComputedStyle(t).overflowY, inside: b.top >= 0 && b.bottom <= innerHeight }; })()`;
        expect(await tab.evaluate(whole)).toEqual({ cut: false, mask: "none", scrolls: "auto", inside: true });
        // The cross in the bubble's corner closes it for this browser tab; the answer stays in the chat.
        const corner = await tab.evaluate("(() => { const b = [...document.querySelectorAll('#messages > .w-msg[data-role=\"agent\"]')].pop().getBoundingClientRect(); return [b.right - 12, b.top + 12]; })()");
        await tab.click(corner);
        await tab.settle({ collapsed: true, bubbles: [] });
        await tab.evaluate("location.reload()");
        await Bun.sleep(300);
        await tab.ready();
        await tab.rest();
        await tab.settle({ collapsed: true, bubbles: [], unread: null });
        expect(await tab.evaluate("document.querySelectorAll('#messages > .w-msg').length")).toBe(2);

        // The person asks again and the agent works: their message is the bubble, the running call a chip.
        await ctx.fns.session.appendUserMessage({ id, text: "by week, please" });
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'running', next_run_at = NULL WHERE id = ?", params: [id] });
        runs.set("fold-test", { id: "fold-test", agentId: id, name: "bash", subject: "bun test", icon: "ph-terminal-window", startedAt: Date.now(), timeoutMs: null, tail: "", aborted: false, controller: new AbortController() });
        await tab.evaluate("location.reload()");
        await Bun.sleep(300);
        await tab.ready();
        await tab.rest();
        await tab.settle({ bubbles: ["user"], tool: "bash bun test" });

        // A new answer replaces it and is counted on the circle until the box is opened.
        runs.delete("fold-test");
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'idle' WHERE id = ?", params: [id] });
        await answer("Rebuilt by week. " + "Every line of a long answer stays readable. ".repeat(12));
        await tab.settle({ bubbles: ["agent"], unread: "1", tool: "" });
        expect(await tab.evaluate(whole)).toEqual({ cut: false, mask: "none", scrolls: "auto", inside: true });
        await answer("And a very long one. " + "It scrolls inside the bubble and never leaves the window. ".repeat(160));
        await tab.settle({ bubbles: ["agent"], unread: "2", tool: "" });
        expect(await tab.evaluate(whole)).toEqual({ cut: true, mask: "none", scrolls: "auto", inside: true });
        await tab.focusKey();
        await tab.settle({ open: true, focused: true, unread: null, bubbles: ["agent"] });
        // The same key again puts everything away: the bubbles close and the field folds into the circle — with a
        // draft too, which waits in the box for the next time.
        await tab.key("x", "KeyX", 88, "x");
        await tab.settle({ open: true, focused: true, text: "x" });
        await tab.focusKey();
        await tab.settle({ open: false, focused: false, size: [44, 44], bubbles: [], unread: null, text: "x" });
        await tab.focusKey();
        await tab.settle({ open: true, focused: true, bubbles: [], text: "x" });
        // A new answer is a new bubble.
        await answer("One more.");
        await tab.settle({ open: true, bubbles: ["agent"] });
    } finally {
        runs.delete("fold-test");
        await tab.close();
    }
}, 60_000);

test.skipIf(!CDP)("switching to a chat whose chat is folded puts the caret in its message box", async () => {
    const from = await ctx.fns.agent.start({ model: "mock:test", title: "column chat" });
    const to = await ctx.fns.agent.start({ model: "mock:test", title: "folded chat" });
    await ctx.fns.canvas.show({ agentId: to.id, kind: "html", title: "Drawing", args: { html: "<p>drawing</p>" } });
    await ctx.fns.canvas.update({ agentId: to.id, chatCollapsed: true });
    const tab = await openTab(`http://127.0.0.1:${server.port}/agent/${from.id}`);
    try {
        await tab.send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await tab.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
        const here = (id: string) => `(() => { const r = document.querySelector('[data-canvas-agent="${id}"]'); return !!r && !!window.__hyperCanvasInstalled && { collapsed: r.hasAttribute('data-chat-collapsed'), open: r.hasAttribute('data-chat-open'), focused: document.activeElement?.id === 'input' && r.contains(document.activeElement) }; })()`;
        const until = async (id: string, want: Record<string, boolean>) => { let now: any = null; for (let i = 0; i < 100; i++) { now = await tab.evaluate(here(id)); if (now && JSON.stringify(now) === JSON.stringify(want)) break; await Bun.sleep(50); } return now; };
        expect(await until(from.id, { collapsed: false, open: false, focused: true })).toEqual({ collapsed: false, open: false, focused: true });
        // The way the person switches: the chat's row in the navigation.
        const link = `[...document.querySelectorAll('a[href="/agent/${to.id}"], [hx-get="/agent/${to.id}"]')].find(el => el.offsetParent !== null)`;
        for (let i = 0; i < 60 && !(await tab.evaluate(`!!${link}`)); i++) await Bun.sleep(50);
        expect(await tab.evaluate(`(() => { const el = ${link}; if (!el) return 'no link'; el.click(); return 'clicked'; })()`)).toBe("clicked");
        expect(await until(to.id, { collapsed: true, open: true, focused: true })).toEqual({ collapsed: true, open: true, focused: true });
        // And typing lands in the box right away.
        await tab.send("Input.insertText", { text: "hi" });
        expect(await tab.evaluate("document.getElementById('input').value")).toBe("hi");
    } finally {
        await tab.close();
    }
}, 30_000);
