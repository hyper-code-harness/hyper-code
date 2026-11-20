// FUNCTIONAL test in a real (headless) Chrome: the two things about skills that only a browser can show —
// "/" in the chat's message box suggests the skills a person can start, and the buttons of the Skills pages
// (htmx forms posted with the page's CSRF token) install and remove a skill and redraw themselves in place.
// Skipped without Chrome.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../$test";
import { testChrome } from "../../test/chrome/headless";

const CDP = (await testChrome()) ?? "";
const root = await realpath(await mkdtemp(join(tmpdir(), "skills-browser-")));
const shared = join(root, "shared");
for (const [name, extra] of [["grill-me", 'disable-model-invocation: true\nargument-hint: "[plan]"\n'], ["tdd", ""], ["teach", ""]] as const) {
    await mkdir(join(shared, name), { recursive: true });
    await writeFile(join(shared, name, "SKILL.md"), `---\nname: ${name}\ndescription: The ${name} skill for the browser test.\n${extra}---\n\nDo ${name}.\n`);
}
function git(cwd: string, ...args: string[]) {
    const p = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@l", "-c", "init.defaultBranch=main", ...args], { cwd });
    if (p.exitCode) throw new Error(p.stderr.toString());
}
const work = join(root, "packrepo");
await mkdir(join(work, "skills", "review"), { recursive: true });
await writeFile(join(work, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review a diff.\n---\n\nReview it.\n");
await mkdir(join(work, "skills", "other"), { recursive: true });
await writeFile(join(work, "skills", "other", "SKILL.md"), "---\nname: other\ndescription: Another one.\n---\n\nOther.\n");
git(work, "init", "-q"); git(work, "add", "-A"); git(work, "commit", "-qm", "c");
const repo = "git+file://" + work;

const ctx: any = await testCtx({ env: { HYPER_HOME: join(root, "home"), SKILLS_ROOTS: shared } });
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
    await ctx.fns.procs.migrate.up({});
    ctx.fns.embeddings.provider = async () => "off";
    await ctx.fns.skills.index({});
    await ctx.fns.procs.http.loadRoutes({});
    (ctx.state.procs as any).stylesBootRebuild = true;
    server = Bun.serve({ port: 0, hostname: "127.0.0.1", idleTimeout: 60, fetch: (req, srv) => ctx.fns.procs.http.handle({ req, server: srv }) });
});
afterAll(async () => { server?.stop(true); await rm(root, { recursive: true, force: true }); });

async function open(path: string) {
    const tab: any = await (await fetch(`${CDP}/json/new?${encodeURIComponent(`http://127.0.0.1:${server.port}${path}`)}`, { method: "PUT" })).json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    let n = 0;
    const pending = new Map<number, (v: any) => void>();
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); };
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((ok) => { pending.set(++n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const until = async (expression: string) => { let now: any = null; for (let i = 0; i < 100; i++) { now = await evaluate(expression); if (now) break; await Bun.sleep(50); } return now; };
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.enable");
    // hx-confirm asks through the browser's own dialog: accept it, as a person pressing OK does.
    const prior = ws.onmessage;
    ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.method === "Page.javascriptDialogOpening") void send("Page.handleJavaScriptDialog", { accept: true }); else prior!.call(ws, e); };
    return { send, evaluate, until, close: async () => { ws.close(); await fetch(`${CDP}/json/close/${tab.id}`).catch(() => null); } };
}

test.skipIf(!CDP)("typing / in the message box suggests skills; arrows choose, Enter puts /name into the box without sending", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test", tools: ["skill"] });
    const page = await open(`/agent/${agent.id}`);
    const input = `document.querySelector('#chat-panel textarea')`;
    const type = (text: string) => page.evaluate(`(() => { const t = ${input}; t.focus(); t.value = ${JSON.stringify(text)}; t.setSelectionRange(t.value.length, t.value.length); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const options = `(() => { const b = document.querySelector('[data-mention-list]'); return b && !b.hidden ? [...b.querySelectorAll('[role=option]')].map(o => o.querySelector('span span').textContent) : null; })()`;
    try {
        expect(await page.until(`!!(window.htmx && document.body.dataset.agentId && ${input})`)).toBe(true);
        await type("/");
        expect(await page.until(options)).toEqual(["/grill-me [plan]", "/tdd", "/teach"]);
        expect(await page.evaluate(`document.querySelector('[data-mention-list]').getAttribute('aria-label')`)).toBe("Start a skill");
        await type("/t");
        expect(await page.until(`(${options})?.length === 2 && ${options}`)).toEqual(["/tdd", "/teach"]);
        // ↓ moves to the second, Enter picks it — and does not send the message.
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
        await page.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        expect(await page.until(`${input}.value === '/teach ' && ${input}.value`)).toBe("/teach ");
        expect(await page.evaluate(options)).toBeNull();
        expect((await ctx.fns.session.getMessages({ id: agent.id })).length).toBe(0);
        // A path is not a command, and neither is a slash later in the text.
        await type("/usr/bin/env");
        await Bun.sleep(150);
        expect(await page.evaluate(options)).toBeNull();
        await type("see /t");
        await Bun.sleep(150);
        expect(await page.evaluate(options)).toBeNull();
    } finally { await page.close(); }
}, 30_000);

test.skipIf(!CDP)("an agent without the skill tool gets no suggestions", async () => {
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const page = await open(`/agent/${agent.id}`);
    const input = `document.querySelector('#chat-panel textarea')`;
    try {
        expect(await page.until(`!!(window.htmx && document.body.dataset.agentId && ${input})`)).toBe(true);
        await page.evaluate(`(() => { const t = ${input}; t.focus(); t.value = '/'; t.setSelectionRange(1, 1); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await Bun.sleep(300);
        expect(await page.evaluate(`(() => { const b = document.querySelector('[data-mention-list]'); return !!b && !b.hidden; })()`)).toBe(false);
    } finally { await page.close(); }
}, 30_000);

test.skipIf(!CDP)("the buttons of a repository's page install one skill and remove it again, redrawing in place", async () => {
    const page = await open(ctx.fns.rpc.url({ fn: "skills.previewPage", params: { repo } }));
    const button = (label: string) => `[...document.querySelectorAll('[data-skills-actions] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    const labels = `[...document.querySelectorAll('[data-skills-actions] button')].map(b => b.textContent.trim())`;
    const installed = async () => Object.keys((await ctx.fns.skills.lockFile({})).lock.packs.packrepo?.skills ?? {}).sort();
    try {
        expect(await page.until(`!!(window.htmx && ${button("Install all")})`)).toBe(true);
        expect(await page.evaluate(labels)).toEqual(["Install all", "Install this skill", "Install this skill"]);
        expect(await page.evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true);   // nothing scrolls sideways

        // The first "Install this skill" belongs to `other` (skills are listed by name).
        await page.evaluate(`${button("Install this skill")}.click()`);
        expect(await page.until(`document.body.textContent.includes('Installed other into pack packrepo')`)).toBe(true);
        expect(await installed()).toEqual(["other"]);
        // The page follows: the installed skill now offers Remove, the other one Add, the pack its own buttons.
        expect(await page.until(`!!${button("Remove this skill")} && !!${button("Add this skill")} && !!${button("Remove the pack")}`)).toBe(true);

        await page.evaluate(`${button("Remove this skill")}.click()`);
        expect(await page.until(`!${button("Remove the pack")} && !!${button("Install all")}`)).toBe(true);
        expect(await installed()).toEqual([]);
        expect((await ctx.fns.skills.lockFile({})).lock.packs.packrepo).toBeUndefined();
    } finally { await page.close(); }
}, 60_000);
