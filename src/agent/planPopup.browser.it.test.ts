// FUNCTIONAL test in a real (headless) Chrome: the chat's plan as a to-do list. The count in the message box opens
// it; tasks are typed one after another, dragged into order, ticked off (finished ones go to the bottom), renamed
// and removed with the mouse and the keyboard — and the list follows the agent by itself. Skipped without Chrome.
// PLAN_SHOTS=<dir> also writes screenshots of the states there.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
const SHOTS = process.env.PLAN_SHOTS ?? "";
const ctx: any = await mkTestCtx();
let server: ReturnType<typeof Bun.serve>;
// The w sheet under a key of this run: styles.build otherwise serves the sheet a previous process left, without
// a rule added since (the to-do list); the server's file stays its own.
const sheets: string[] = [];

beforeAll(async () => {
    await ctx.fns.procs.http.loadRoutes({});
    const style = (ctx.state.procs.styles ?? []).find((s: any) => s.href === "/w/w.css");
    if (CDP && style) { style.key = `${style.key}_it_${process.pid}`; sheets.push(await ctx.fns.procs.styles.build({ abs: style.abs, key: style.key, force: true })); }
    // No background rebuild of every sheet from the first page load: it would outlive this file.
    (ctx.state.procs as any).stylesBootRebuild = true;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 60, fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }) });
});
afterAll(async () => {
    server?.stop(true);
    for (const file of sheets.flatMap(s => [s, s.replace(/\.css$/, ".in.css")])) await Bun.file(file).delete().catch(() => undefined);
});

test.skipIf(!CDP)("the plan count opens a to-do list: type tasks, drag them into order, tick, rename, remove — and it follows the agent", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/agent/${agent.id}`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let n = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { pending.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const until = async (expression: string) => { let now: any = null; for (let i = 0; i < 100; i++) { now = await evaluate(expression); if (now) break; await Bun.sleep(50); } return now; };
    // The person's hands: a real mouse and a real keyboard.
    const mouse = (type: string, x: number, y: number, more: Record<string, unknown> = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !more.buttons ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, ...more });
    const centre = (selector: string) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const click = async (selector: string) => { const at = await centre(selector); await mouse("mouseMoved", at.x, at.y); await mouse("mousePressed", at.x, at.y); await mouse("mouseReleased", at.x, at.y); };
    const key = (name: string, code: number, text?: string) => send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code, text }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code }));
    const type = (text: string) => send("Input.insertText", { text });
    const row = (id: string) => `#app-popup [data-todo-id="${id}"]`;
    // The list as the person sees it, top to bottom: "status:title".
    const list = `[...document.querySelectorAll('#app-popup [data-todo-id]')].map(li => li.dataset.status + ':' + li.querySelector('.w-todo-text').textContent)`;
    const listIs = async (want: string[]) => { await until(`JSON.stringify(${list}) === ${JSON.stringify(JSON.stringify(want))}`); return await evaluate(list); };
    const stored = async () => ((await ctx.fns.session.load({ id: agent.id })).scratchpad.plan?.tasks ?? []).map((t: any) => `${t.status}:${t.title}`);
    const focus = `(() => { const el = document.activeElement; return el?.closest('[data-todo-add]') ? 'add' : el?.matches('[data-todo-grip]') ? 'grip:' + el.closest('[data-todo-id]').dataset.todoId : el?.matches('.w-todo-edit') ? 'edit' : el?.matches('[data-todo-title]') ? 'title' : el?.tagName; })()`;
    const badge = `(() => { const b = document.querySelector('#chat-plan-badge button'); if (!b) return null; const box = b.getBoundingClientRect(); return { text: b.textContent.trim(), status: b.dataset.status, badge: b.classList.contains('w-badge'), width: Math.round(box.width) }; })()`;
    const shot = async (name: string, selector = "#app-popup") => {
        if (!SHOTS) return;
        const b = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
        const png = (await send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24, scale: 2 } })).result.data;
        await Bun.write(`${SHOTS}/${name}.png`, Buffer.from(png, "base64"));
    };
    try {
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
        expect(await until(`!!(window.htmx && window.hyperPopup && window.__hyperTodoInstalled && window.__hyperEventsInstalled && document.querySelector('#chat-plan-badge button'))`)).toBe(true);
        // The event stream needs a moment after the script is in: a refresh sent before it connects is not replayed.
        await Bun.sleep(400);
        // No plan: a quiet list icon, one small square after the goal's target.
        expect(await evaluate(badge)).toEqual({ text: "", status: "none", badge: false, width: 28 });
        await shot("1-bar-empty", ".w-composer-meters");

        // It opens an empty list with the cursor already in the field: tasks are typed one after another.
        await click("#chat-plan-badge button");
        expect(await until(`!!document.querySelector('#app-popup [data-todo]')`)).toBe(true);
        expect(await until(`${focus} === 'add' && ${focus}`)).toBe("add");
        await shot("2-empty");
        for (const title of ["Write the text", "Draw the cover", "Publish", "Tell everyone"]) {
            await type(title);
            await key("Enter", 13, "\r");
            expect(await until(`${list}.some(row => row.endsWith(${JSON.stringify(":" + title)}))`)).toBe(true);
            // The field is empty and still has the cursor.
            expect(await evaluate(`document.querySelector('#app-popup [data-todo-add] input').value + '|' + ${focus}`)).toBe("|add");
        }
        expect(await listIs(["active:Write the text", "pending:Draw the cover", "pending:Publish", "pending:Tell everyone"])).toEqual(["active:Write the text", "pending:Draw the cover", "pending:Publish", "pending:Tell everyone"]);
        // Nobody works yet: the count is grey, the list says so and offers Start.
        expect(await until(`(${badge})?.text === '0/4' && ${badge}`)).toMatchObject({ text: "0/4", status: "paused", badge: true });
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-summary]').textContent`)).toBe("Not started · 0 of 4 done");
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-act="start"]').textContent.trim()`)).toBe("Start");
        await shot("3-typed");

        // Drag the last task to the very top — by the row itself, no need to aim at the grip: the others step aside.
        // Nobody works yet, so the top one is simply the one the agent will take first.
        const from = await centre(`${row("task-4")} .w-todo-text`);
        const top = await centre(`${row("task-1")} .w-todo-text`);
        await mouse("mouseMoved", from.x, from.y);
        await mouse("mousePressed", from.x, from.y);
        for (let step = 1; step <= 6; step++) await mouse("mouseMoved", from.x, from.y + ((top.y - 6 - from.y) * step) / 6, { buttons: 1 });
        // In the air: the dragged row is lifted, the three it passed have moved down by its height.
        const air = `[...document.querySelectorAll('#app-popup [data-todo-id]')].map(li => (li.hasAttribute('data-dragging') ? 'drag' : '') + Math.round(new DOMMatrix(getComputedStyle(li).transform).m42 / 10)).join(' ')`;
        expect(await until(`${air} === '3 3 3 drag-8' && ${air}`) || await evaluate(air)).toBe("3 3 3 drag-8");
        await shot("4-dragging");
        await mouse("mouseReleased", from.x, top.y - 6);
        expect(await listIs(["active:Tell everyone", "pending:Write the text", "pending:Draw the cover", "pending:Publish"])).toEqual(["active:Tell everyone", "pending:Write the text", "pending:Draw the cover", "pending:Publish"]);
        // Letting go of a row is not a click on its text: no rename field opened, nothing selected.
        expect(await evaluate(`!!document.querySelector('#app-popup .w-todo-edit') + '|' + !!window.getSelection().toString()`)).toBe("false|false");
        await until(`!document.querySelector('#app-popup [data-todo]').hasAttribute('data-busy')`);
        expect(await stored()).toEqual(["active:Tell everyone", "pending:Write the text", "pending:Draw the cover", "pending:Publish"]);
        // The grip at the end of a row does the same: put "Write the text" back on top.
        await mouse("mouseMoved", (await centre(row("task-1"))).x, (await centre(row("task-1"))).y);
        const grip = await centre(`${row("task-1")} [data-todo-grip]`);
        const first = await centre(`${row("task-4")} [data-todo-grip]`);
        await mouse("mouseMoved", grip.x, grip.y);
        await mouse("mousePressed", grip.x, grip.y);
        for (let step = 1; step <= 4; step++) await mouse("mouseMoved", grip.x, grip.y + ((first.y - 6 - grip.y) * step) / 4, { buttons: 1 });
        await mouse("mouseReleased", grip.x, first.y - 6);
        expect(await listIs(["active:Write the text", "pending:Tell everyone", "pending:Draw the cover", "pending:Publish"])).toEqual(["active:Write the text", "pending:Tell everyone", "pending:Draw the cover", "pending:Publish"]);
        await until(`!document.querySelector('#app-popup [data-todo]').hasAttribute('data-busy')`);
        expect(await stored()).toEqual(["active:Write the text", "pending:Tell everyone", "pending:Draw the cover", "pending:Publish"]);

        // The keyboard does the same: ↓ on a grip moves the task down, and the grip keeps the focus for the next press.
        await evaluate(`document.querySelector(${JSON.stringify(`${row("task-4")} [data-todo-grip]`)}).focus()`);
        await key("ArrowDown", 40);
        expect(await listIs(["active:Write the text", "pending:Draw the cover", "pending:Tell everyone", "pending:Publish"])).toHaveLength(4);
        expect(await until(`${focus} === 'grip:task-4' && !document.querySelector('#app-popup [data-todo]').hasAttribute('data-busy')`)).toBe(true);
        await key("ArrowDown", 40);
        expect(await listIs(["active:Write the text", "pending:Draw the cover", "pending:Publish", "pending:Tell everyone"])).toEqual(["active:Write the text", "pending:Draw the cover", "pending:Publish", "pending:Tell everyone"]);

        // Rename in place: click the text, type, Enter. Escape in the field gives the name back and keeps the popup.
        await click(`${row("task-2")} [data-todo-title]`);
        expect(await until(`${focus} === 'edit'`)).toBe(true);
        await type("Draw the cover in blue");
        await key("Enter", 13, "\r");
        expect(await listIs(["active:Write the text", "pending:Draw the cover in blue", "pending:Publish", "pending:Tell everyone"])).toContain("pending:Draw the cover in blue");
        await click(`${row("task-3")} [data-todo-title]`);
        expect(await until(`${focus} === 'edit'`)).toBe(true);
        await type("oops");
        await key("Escape", 27);
        expect(await evaluate(`document.getElementById('app-popup').open + '|' + document.querySelector(${JSON.stringify(`${row("task-3")} .w-todo-text`)}).textContent`)).toBe("true|Publish");

        // Tick a queued task: it leaves the list — the finished ones are folded under one "Done · 1" line at the bottom.
        await click(`${row("task-3")} .w-todo-mark`);
        expect(await listIs(["active:Write the text", "pending:Draw the cover in blue", "pending:Tell everyone", "done:Publish"])).toEqual(["active:Write the text", "pending:Draw the cover in blue", "pending:Tell everyone", "done:Publish"]);
        const folded = `(() => { const box = document.querySelector('#app-popup [data-todo-done-box]'), add = document.querySelector('#app-popup [data-todo-add]'), done = box.querySelector('[data-todo-id]'); return { open: box.open, line: box.querySelector('summary').textContent, belowTheField: box.getBoundingClientRect().top >= add.getBoundingClientRect().bottom, rowShown: done.checkVisibility(), struck: getComputedStyle(done.querySelector('.w-todo-text')).textDecorationLine }; })()`;
        expect(await evaluate(folded)).toEqual({ open: false, line: "Done · 1", belowTheField: true, rowShown: false, struck: "line-through" });
        expect(await until(`(${badge})?.text === '1/4'`)).toBe(true);
        // A click on that line unfolds them — and they stay unfolded while the list changes.
        await click(`#app-popup [data-todo-done-box] > summary`);
        expect(await evaluate(folded)).toEqual({ open: true, line: "Done · 1", belowTheField: true, rowShown: true, struck: "line-through" });
        await click(`${row("task-4")} .w-todo-mark`);
        expect(await listIs(["active:Write the text", "pending:Draw the cover in blue", "done:Publish", "done:Tell everyone"])).toHaveLength(4);
        expect(await evaluate(folded)).toMatchObject({ open: true, line: "Done · 2", rowShown: true });
        // The mark of a finished task reopens it: it goes back to the top of the queue. The cross removes a task that has not started.
        await click(`${row("task-4")} .w-todo-mark`);
        expect(await listIs(["active:Write the text", "pending:Tell everyone", "pending:Draw the cover in blue", "done:Publish"])).toHaveLength(4);
        await click(`${row("task-3")} .w-todo-mark`);
        expect(await listIs(["active:Write the text", "pending:Publish", "pending:Tell everyone", "pending:Draw the cover in blue"])).toEqual(["active:Write the text", "pending:Publish", "pending:Tell everyone", "pending:Draw the cover in blue"]);
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-done-box]')`)).toBeNull();
        await click(`${row("task-4")} .w-todo-remove`);
        expect(await listIs(["active:Write the text", "pending:Publish", "pending:Draw the cover in blue"])).toEqual(["active:Write the text", "pending:Publish", "pending:Draw the cover in blue"]);
        expect(await evaluate(`document.querySelector(${JSON.stringify(`${row("task-1")} .w-todo-remove`)})`)).toBeNull();

        // Start: the agent is told to take the current task — the list turns to "working", the count turns blue.
        await click(`#app-popup [data-todo-act="start"]`);
        expect(await until(`document.querySelector('#app-popup [data-todo]')?.dataset.state === 'working'`)).toBe(true);
        expect(await evaluate(`!!document.querySelector('#app-popup [data-todo-act="start"]') + '|' + !!document.querySelector(${JSON.stringify(`${row("task-1")} .w-arc`)}) + '|' + !!document.querySelector(${JSON.stringify(`${row("task-1")} .w-timer`)})`)).toBe("false|true|true");
        expect(await until(`(${badge})?.status === 'working'`)).toBe(true);
        // The agent is on the current task now: it stays where it is, the queue still moves.
        expect(await evaluate(`[...document.querySelectorAll('#app-popup [data-todo-movable]')].map(li => li.dataset.todoId).join(' ')`)).toBe("task-3 task-2");
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(String(messages[messages.length - 1].content)).toContain("Task ID: task-1");

        // The agent finishes a task: the open list follows by itself, and the text being typed stays in the field.
        await evaluate(`document.querySelector('#app-popup [data-todo-add] input').focus()`);
        await type("Half a thou");
        await ctx.fns.session.done({ agent, id: "task-1" });
        expect(await listIs(["active:Publish", "pending:Draw the cover in blue", "done:Write the text"])).toEqual(["active:Publish", "pending:Draw the cover in blue", "done:Write the text"]);
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-add] input').value + '|' + ${focus}`)).toBe("Half a thou|add");
        await type("ght");
        await key("Enter", 13, "\r");
        expect(await listIs(["active:Publish", "pending:Draw the cover in blue", "pending:Half a thought", "done:Write the text"])).toHaveLength(4);
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-summary]').textContent`)).toMatch(/^1 of 4 done/);
        // What the agent finished is folded too.
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-done-box]').open + '|' + document.querySelector('#app-popup [data-todo-done-box] > summary').textContent`)).toBe("false|Done · 1");
        await shot("5-working");
        await mouse("mouseMoved", (await centre(row("task-2"))).x, (await centre(row("task-2"))).y);
        await Bun.sleep(200);
        await shot("6-hover");

        // The plan changes while a row is held: the list is left alone under the hand, and catches up on release —
        // also when the row is put back where it was and nothing is sent.
        const held = await centre(`${row("task-2")} .w-todo-text`);
        await mouse("mouseMoved", held.x, held.y);
        await mouse("mousePressed", held.x, held.y);
        await mouse("mouseMoved", held.x, held.y + 8, { buttons: 1 });
        expect(await until(`document.querySelector(${JSON.stringify(row("task-2"))}).hasAttribute('data-dragging')`)).toBe(true);
        const late = await ctx.fns.session.editPlanTask({ agent, action: "add", title: "Arrived meanwhile" });
        await Bun.sleep(500);
        expect(await evaluate(`${list}.length`)).toBe(4);
        await mouse("mouseMoved", held.x, held.y, { buttons: 1 });
        await mouse("mouseReleased", held.x, held.y);
        expect(await listIs(["active:Publish", "pending:Draw the cover in blue", "pending:Half a thought", "pending:Arrived meanwhile", "done:Write the text"])).toHaveLength(5);
        await ctx.fns.session.editPlanTask({ agent, action: "remove", id: late.added });
        expect(await listIs(["active:Publish", "pending:Draw the cover in blue", "pending:Half a thought", "done:Write the text"])).toHaveLength(4);

        // Details opens the full plan editor (the agent inspector) on the canvas and closes the popup.
        await click(`#app-popup [data-todo-act="edit"]`);
        expect(await until(`!document.getElementById('app-popup').open`)).toBe(true);
        expect(await until(`document.querySelector('[data-canvas-agent]').hasAttribute('data-canvas-open')`)).toBe(true);
        expect(await until(`(${badge})?.text === '1/4' && ${badge}`)).toMatchObject({ text: "1/4", status: "working", badge: true });
        await shot("7-bar", ".w-composer-meters");

        // A phone: the same list in a narrow popup, nothing cut off.
        await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
        await evaluate(`document.querySelector('#chat-plan-badge button')?.click() ?? htmx.ajax('POST', '/rpc', { target: '#app-popup-body', swap: 'innerHTML', values: { method: 'agent.planPopup', params: JSON.stringify({ agentId: ${JSON.stringify(agent.id)} }) }, headers: window.hyperRpcCsrfHeaders() })`);
        expect(await until(`!!document.querySelector('#app-popup [data-todo]') && document.getElementById('app-popup').open`)).toBe(true);
        expect(await evaluate(`(() => { const d = document.getElementById('app-popup').getBoundingClientRect(), t = document.querySelector('#app-popup [data-todo]'); return { fits: d.left >= 0 && d.right <= innerWidth, noSideScroll: t.scrollWidth <= t.clientWidth + 1 }; })()`)).toEqual({ fits: true, noSideScroll: true });
        await shot("8-phone");
    } finally {
        ws.close();
        await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null);
    }
}, 90_000);

test.skipIf(!CDP)("tasks take images and files: paste into the field, the paperclip, a drop on a task — shown under the task, with the chat's own chips", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/hyper-plan-files-`);
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/agent/${agent.id}`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let n = 0;
    const pending = new Map<number, (v: any) => void>();
    const choosers: any[] = [];
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.method === "Page.fileChooserOpened") choosers.push(m.params); pending.get(m.id)?.(m); };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { pending.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const until = async (expression: string) => { let now: any = null; for (let i = 0; i < 100; i++) { now = await evaluate(expression); if (now) break; await Bun.sleep(50); } return now; };
    const mouse = (type: string, x: number, y: number) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    const centre = (selector: string) => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const click = async (selector: string) => { const at = await centre(selector); await mouse("mouseMoved", at.x, at.y); await mouse("mousePressed", at.x, at.y); await mouse("mouseReleased", at.x, at.y); };
    const key = (name: string, code: number, text?: string) => send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code, text }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code }));
    const row = (id: string) => `#app-popup [data-todo-id="${id}"]`;
    // Each task as "title [its files]".
    const list = `[...document.querySelectorAll('#app-popup [data-todo-id]')].map(li => li.querySelector('.w-todo-text').textContent + ' [' + [...li.querySelectorAll('.w-todo-file')].map(f => f.querySelector('img') ? 'img:' + f.querySelector('img').alt : 'file:' + f.textContent.trim()).join(', ') + ']')`;
    const listIs = async (want: string[]) => { await until(`JSON.stringify(${list}) === ${JSON.stringify(JSON.stringify(want))}`); return await evaluate(list); };
    const stored = async () => ((await ctx.fns.session.load({ id: agent.id })).scratchpad.plan?.tasks ?? []).map((t: any) => `${t.title} [${(t.attachments ?? []).map((f: any) => f.fileName).join(", ")}]`);
    // A picture a person would paste: drawn in the page, so it is a real image the browser can show.
    const picture = `await new Promise(done => { const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#e8f1fe'; g.fillRect(0, 0, 320, 200); g.fillStyle = '#2563eb'; g.fillRect(24, 24, 120, 14); g.fillStyle = '#8a94a1'; for (let i = 0; i < 5; i++) g.fillRect(24, 56 + i * 24, 272 - i * 30, 10); c.toBlob(b => done(new File([b], 'mockup.png', { type: 'image/png' })), 'image/png'); })`;
    const shot = async (name: string, selector = "#app-popup") => {
        if (!SHOTS) return;
        const b = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
        const png = (await send("Page.captureScreenshot", { format: "png", clip: { x: Math.max(0, b.x - 12), y: Math.max(0, b.y - 12), width: b.width + 24, height: b.height + 24, scale: 2 } })).result.data;
        await Bun.write(`${SHOTS}/${name}.png`, Buffer.from(png, "base64"));
    };
    try {
        await send("Page.enable");
        await send("Page.setInterceptFileChooserDialog", { enabled: true });
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
        expect(await until(`!!(window.htmx && window.hyperPopup && window.hyperFiles && window.__hyperTodoInstalled && window.__hyperEventsInstalled && document.querySelector('#chat-plan-badge button'))`)).toBe(true);
        await Bun.sleep(400);
        // Two files on disk for the file pickers.
        await Bun.write(`${dir}/notes.txt`, "what the cover must say");
        await Bun.write(`${dir}/shot.png`, Buffer.from(String(await evaluate(`(async () => { const f = ${picture}; const b = new Uint8Array(await f.arrayBuffer()); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); })()`)), "base64"));

        // The chat's own message box still shows a picked file as it did — the chip is now shared with the list.
        const chatPicker = (await send("Runtime.evaluate", { expression: `document.querySelector('#files')` })).result.result.objectId;
        await send("DOM.setFileInputFiles", { files: [`${dir}/notes.txt`], objectId: chatPicker });
        expect(await until(`document.querySelector('[data-attachments] .w-composer-file')?.textContent`)).toBe("notes.txt");
        await click(`[data-attachments] .w-composer-file button`);
        expect(await until(`!document.querySelector('[data-attachments] .w-composer-file') && document.querySelector('#files').files.length === 0`)).toBe(true);

        // The list: paste a screenshot into the field — it waits above it as the same chip, and the cursor stays in the field.
        await click("#chat-plan-badge button");
        expect(await until(`!!document.querySelector('#app-popup [data-todo-add] input[name="title"]') && document.activeElement?.name === 'title'`)).toBe(true);
        await evaluate(`(async () => { const dt = new DataTransfer(); dt.items.add(${picture}); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
        expect(await until(`document.querySelector('#app-popup [data-todo-tray] .w-composer-file')?.textContent`)).toBe("mockup.png");
        expect(await evaluate(`!!document.querySelector('#app-popup [data-todo-tray] .w-composer-file img') + '|' + document.activeElement?.name`)).toBe("true|title");
        await send("Input.insertText", { text: "Make the cover like this" });
        await shot("9-attach-picked");
        // Enter: the task is made with its picture under the title — a real image, served like a chat attachment.
        await key("Enter", 13, "\r");
        expect(await listIs(["Make the cover like this [img:mockup.png]"])).toEqual(["Make the cover like this [img:mockup.png]"]);
        expect(await until(`(() => { const i = document.querySelector(${JSON.stringify(`${row("task-1")} .w-attach-img img`)}); return i.complete && i.naturalWidth === 320 && i.getBoundingClientRect().height > 20; })()`)).toBe(true);
        expect(await evaluate(`document.querySelectorAll('#app-popup [data-todo-tray] > *').length + '|' + document.querySelector('#app-popup [data-todo-add] input[name="title"]').value + '|' + document.activeElement?.name`)).toBe("0||title");
        expect(await stored()).toEqual(["Make the cover like this [mockup.png]"]);

        // A second, plain task; then its paperclip opens the file picker and the chosen file is attached to it.
        await send("Input.insertText", { text: "Write the text" });
        await key("Enter", 13, "\r");
        expect(await listIs(["Make the cover like this [img:mockup.png]", "Write the text []"])).toHaveLength(2);
        await mouse("mouseMoved", (await centre(row("task-2"))).x, (await centre(row("task-2"))).y);
        await click(`${row("task-2")} [data-todo-pick]`);
        for (let i = 0; i < 60 && !choosers.length; i++) await Bun.sleep(50);
        expect(choosers).toHaveLength(1);
        // While the system's file dialog is open the agent's side changes the plan and the list is redrawn under it —
        // the chosen file still lands on the task it was picked for.
        await ctx.fns.session.editPlanTask({ agent, action: "add", title: "Publish" });
        expect(await until(`${list}.length === 3`)).toBe(true);
        await send("DOM.setFileInputFiles", { files: [`${dir}/notes.txt`], backendNodeId: choosers[0].backendNodeId });
        expect(await listIs(["Make the cover like this [img:mockup.png]", "Write the text [file:notes.txt]", "Publish []"])).toEqual(["Make the cover like this [img:mockup.png]", "Write the text [file:notes.txt]", "Publish []"]);
        await click(`${row("task-3")} .w-todo-remove`);
        expect(await listIs(["Make the cover like this [img:mockup.png]", "Write the text [file:notes.txt]"])).toHaveLength(2);

        // A file dragged from the desktop: the task under it is ringed, and takes the file on drop.
        const drag = (type: string, selector: string) => evaluate(`(async () => { const dt = new DataTransfer(); dt.items.add(${picture}); const el = document.querySelector(${JSON.stringify(selector)}); const b = el.getBoundingClientRect(); return el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + 10 })); })()`);
        await drag("dragover", `${row("task-2")} .w-todo-text`);
        expect(await evaluate(`[...document.querySelectorAll('#app-popup [data-drop]')].map(el => el.dataset.todoId || 'field').join()`)).toBe("task-2");
        await drag("drop", `${row("task-2")} .w-todo-text`);
        expect(await listIs(["Make the cover like this [img:mockup.png]", "Write the text [file:notes.txt, img:mockup.png]"])).toHaveLength(2);
        expect(await evaluate(`document.querySelectorAll('#app-popup [data-drop]').length`)).toBe(0);
        // Anywhere else on the list it is for a new task: the field is ringed and the file waits there.
        await drag("dragover", `#app-popup .w-todo-foot`);
        expect(await evaluate(`[...document.querySelectorAll('#app-popup [data-drop]')].map(el => el.dataset.todoId || 'field').join()`)).toBe("field");
        await drag("drop", `#app-popup .w-todo-foot`);
        expect(await until(`document.querySelectorAll('#app-popup [data-todo-tray] .w-composer-file').length`)).toBe(1);
        await mouse("mouseMoved", (await centre(row("task-2"))).x, (await centre(row("task-2"))).y);
        await Bun.sleep(150);
        await shot("10-attached");
        // The chip's cross drops the waiting file; the cross on an attached one takes it off the task.
        await click(`#app-popup [data-todo-tray] .w-composer-file button`);
        expect(await until(`document.querySelectorAll('#app-popup [data-todo-tray] > *').length === 0`)).toBe(true);
        await mouse("mouseMoved", (await centre(`${row("task-2")} .w-todo-file`)).x, (await centre(`${row("task-2")} .w-todo-file`)).y);
        await click(`${row("task-2")} .w-todo-file .w-todo-detach`);
        expect(await listIs(["Make the cover like this [img:mockup.png]", "Write the text [img:mockup.png]"])).toEqual(["Make the cover like this [img:mockup.png]", "Write the text [img:mockup.png]"]);
        await until(`!document.querySelector('#app-popup [data-todo]').hasAttribute('data-busy')`);
        expect(await stored()).toEqual(["Make the cover like this [mockup.png]", "Write the text [mockup.png]"]);
        // Dragging a row by its picture still reorders, and a row drag is not mistaken for a file drop.
        expect(await evaluate(`document.querySelector(${JSON.stringify(`${row("task-1")} .w-attach-img img`)}).draggable`)).toBe(false);
    } finally {
        ws.close();
        await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null);
        await rm(dir, { recursive: true, force: true });
    }
}, 90_000);

test.skipIf(!CDP)("⌘Enter in the chat's message box adds what is written to the plan instead of sending it — text, files and all", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/agent/${agent.id}`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let n = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { pending.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const until = async (expression: string) => { let now: any = null; for (let i = 0; i < 100; i++) { now = await evaluate(expression); if (now) break; await Bun.sleep(50); } return now; };
    const mac = await evaluate("/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)");
    // The chord the default keymap binds to chat.toTask, Mod-Enter: ⌘Enter on a Mac, Ctrl+Enter elsewhere.
    const modEnter = async () => { for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: mac ? 4 : 2 }); };
    const key = (name: string, code: number, text?: string, modifiers = 0) => send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: code, text, modifiers }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: code, modifiers }));
    const tasks = async () => ((await ctx.fns.session.load({ id: agent.id })).scratchpad.plan?.tasks ?? []).map((t: any) => `${t.status}:${t.title}|${t.instructions}|${(t.attachments ?? []).map((f: any) => f.fileName).join("+")}`);
    const said = async () => (await ctx.fns.session.getMessages({ id: agent.id })).filter((m: any) => m.role === "user").length;
    const box = `({ text: document.querySelector('#chat-panel #input').value, files: document.querySelector('#chat-panel #files').files.length, chips: document.querySelectorAll('#chat-panel [data-attachments] .w-composer-file').length, focused: document.activeElement?.id === 'input' })`;
    const badge = `document.querySelector('#chat-plan-badge button')?.textContent.trim()`;
    try {
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
        expect(await until(`!!(window.htmx && window.hyperKeys && window.hyperFiles && window.hyperCommands?.['chat.toTask'] && window.__hyperEventsInstalled && document.querySelector('#chat-panel #input'))`)).toBe(true);
        await Bun.sleep(400);
        // The Send button tells about the other key.
        expect(await evaluate(`document.querySelector('#chat-panel button.w-send').title`)).toBe(`Send · Enter — ${mac ? "⌘↵" : "Ctrl+↵"} adds it to the plan instead`);

        // An empty box: the key does nothing (and is left to the browser).
        await evaluate(`document.querySelector('#chat-panel #input').focus()`);
        await modEnter();
        await Bun.sleep(200);
        expect(await tasks()).toEqual([]);

        // A thought of several lines, with a file: ⌘Enter makes it the first task of a new plan — nothing is said to the agent.
        await send("Input.insertText", { text: "Fix the header" });
        await key("Enter", 13, "\r", 8);
        await send("Input.insertText", { text: "It jumps on scroll." });
        await evaluate(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['what it should say'], 'spec.txt', { type: 'text/plain' })); const input = document.querySelector('#chat-panel #files'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        expect(await until(`(${box}).chips === 1 && ${box}`)).toEqual({ text: "Fix the header\nIt jumps on scroll.", files: 1, chips: 1, focused: true });
        // The draft keeper has it by now.
        expect(await until(`localStorage.getItem('hyper-draft:${agent.id}')`)).toBe("Fix the header\nIt jumps on scroll.");
        await modEnter();
        expect(await until(`(${box}).text === '' && ${box}`)).toEqual({ text: "", files: 0, chips: 0, focused: true });
        expect(await tasks()).toEqual(["active:Fix the header|Fix the header\nIt jumps on scroll.|spec.txt"]);
        expect(await said()).toBe(0);
        // The count appears by itself, a toast says where the words went, and the draft is forgotten.
        expect(await until(`${badge} === '0/1'`)).toBe(true);
        expect(await until(`[...document.querySelectorAll('body *')].some(el => el.children.length === 0 && el.textContent === 'Added to the plan')`)).toBe(true);
        expect(await until(`localStorage.getItem('hyper-draft:${agent.id}') === null`)).toBe(true);

        // The next one goes to the end of the list; plain Enter still sends a message to the agent.
        await send("Input.insertText", { text: "Then ship it" });
        await modEnter();
        expect(await until(`${badge} === '0/2'`)).toBe(true);
        expect((await tasks()).map((t: string) => t.split("|")[0])).toEqual(["active:Fix the header", "pending:Then ship it"]);
        await send("Input.insertText", { text: "hello agent" });
        await key("Enter", 13, "\r");
        expect(await until(`(${box}).text === ''`)).toBe(true);
        let users = 0;
        for (let i = 0; i < 60 && !(users = await said()); i++) await Bun.sleep(50);
        expect(users).toBe(1);
        expect(await tasks()).toHaveLength(2);

        // The list shows the rest of a task's words under its title.
        await evaluate(`document.querySelector('#chat-plan-badge button').click()`);
        expect(await until(`document.querySelector('#app-popup [data-todo-id="task-1"] .w-todo-note')?.textContent`)).toBe("It jumps on scroll.");
        expect(await evaluate(`document.querySelector('#app-popup [data-todo-id="task-1"] .w-todo-file')?.textContent.trim()`)).toBe("spec.txt");
        // In the list's own field ⌘Enter is not this command: the caret is not in the message box.
        expect(await evaluate(`!!window.hyperCommands['chat.toTask'].when()`)).toBe(false);
    } finally {
        ws.close();
        await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null);
    }
}, 90_000);
