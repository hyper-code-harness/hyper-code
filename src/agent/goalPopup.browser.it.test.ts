// FUNCTIONAL test in a real (headless) Chrome: setting a chat's goal from the target icon in its message box.
// The form's buttons are told apart by the pressed button's value (ui/rpc.js sends it with the fields), a done
// action closes the popup, and the icon follows without a reload. Skipped without Chrome.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
const ctx: any = await mkTestCtx();
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    await ctx.fns.procs.http.loadRoutes({});
    // No background rebuild of every sheet from the first page load: it would outlive this file.
    (ctx.state.procs as any).stylesBootRebuild = true;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 60, fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }) });
});
afterAll(() => server?.stop(true));

test.skipIf(!CDP)("the target icon opens the goal form: Start needs a text, Save without starting keeps it grey, ⌘Enter starts it and the icon turns blue", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}/agent/${agent.id}`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let n = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { pending.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const until = async (expression: string) => { let now: any = null; for (let i = 0; i < 80; i++) { now = await evaluate(expression); if (now) break; await Bun.sleep(50); } return now; };
    const icon = `(() => { const b = document.querySelector('#chat-goal-badge button'); if (!b) return null; const cs = getComputedStyle(b); return { label: b.getAttribute('aria-label'), tone: b.dataset.tone ?? 'grey', background: cs.backgroundColor, pressed: b.getAttribute('aria-pressed') }; })()`;
    const form = `document.querySelector('#app-popup form[hx-popup="agent.goalPopup"]')`;
    const press = (action: string) => evaluate(`${form}.querySelector('button[name="action"][value="${action}"]').click()`);
    const type = (text: string) => evaluate(`(() => { const t = ${form}.querySelector('textarea[name="statement"]'); t.focus(); t.value = ${JSON.stringify(text)}; })()`);
    try {
        await send("Emulation.setFocusEmulationEnabled", { enabled: true });
        await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
        expect(await until(`!!(window.htmx && window.hyperPopup && document.querySelector('#chat-goal-badge button'))`)).toBe(true);
        // No goal: a grey icon that says so.
        expect(await evaluate(icon)).toEqual({ label: "No goal — click to set one", tone: "grey", background: "rgba(0, 0, 0, 0)", pressed: null });

        await evaluate(`document.querySelector('#chat-goal-badge button').click()`);
        expect(await until(`${form}?.dataset.goalState`)).toBe("new");
        expect(await evaluate(`[...${form}.querySelectorAll('button[name="action"]')].map(b => b.textContent.trim())`)).toEqual(["Start", "Save without starting"]);
        // Start with nothing written is refused in place.
        await press("start");
        expect(await until(`document.querySelector('#app-popup [role="alert"]')?.textContent`)).toBe("Write the goal first.");
        expect(agent.goal ?? null).toBeNull();

        // Save without starting: the popup closes, the goal is kept and not running, the icon stays grey.
        await type("ship the release");
        await press("save");
        expect(await until(`!document.getElementById('app-popup').open`)).toBe(true);
        expect(agent.goal).toMatchObject({ statement: "ship the release", enabled: false });
        expect(await until(`(${icon})?.label.startsWith('Goal paused') && ${icon}`)).toMatchObject({ label: "Goal paused: ship the release — click to edit", tone: "grey", background: "rgba(0, 0, 0, 0)" });

        // Open again: Resume is the first button, and ⌘/Ctrl+Enter in the text presses it.
        await evaluate(`document.querySelector('#chat-goal-badge button').click()`);
        expect(await until(`${form}?.dataset.goalState`)).toBe("paused");
        expect(await evaluate(`${form}.querySelector('button[name="action"]').textContent.trim()`)).toBe("Resume");
        await type("ship the release today");
        for (const kind of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type: kind, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers: 2 });
        expect(await until(`!document.getElementById('app-popup').open`)).toBe(true);
        expect(agent.goal).toMatchObject({ statement: "ship the release today", enabled: true });
        // Active: blue by colour alone — no pressed state, no background.
        expect(await until(`(${icon})?.tone === 'info' && ${icon}`)).toEqual({ label: "Goal active: ship the release today — click to edit", tone: "info", background: "rgba(0, 0, 0, 0)", pressed: null });
    } finally {
        ws.close();
        await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null);
    }
}, 60_000);
