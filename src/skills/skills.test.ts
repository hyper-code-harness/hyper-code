import { describe, expect, test, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCtx } from "../$test";
import commandsRoute from "./$route_commands_GET";

// One temporary Hyper home and one shared skills folder for the whole file: nothing here reads this machine's
// ~/.hyper, ~/.agents or ~/.claude.
const root = await realpath(await mkdtemp(join(tmpdir(), "skills-test-")));
const shared = join(root, "shared");
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const BIG = "# Big\n\n" + Array.from({ length: 300 }, (_, i) => `Step ${i}: do the thing carefully and check the result twice.`).join("\n") + "\nLAST LINE OF BIG";

async function skill(name: string, frontmatter: string, body: string, files: Record<string, string> = {}) {
    await mkdir(join(shared, name), { recursive: true });
    await writeFile(join(shared, name, "SKILL.md"), `---\nname: ${name}\n${frontmatter}\n---\n\n${body}\n`);
    for (const [rel, text] of Object.entries(files)) {
        await mkdir(join(shared, name, rel, ".."), { recursive: true });
        await writeFile(join(shared, name, rel), text);
    }
}

await skill("alpha", "description: Review a diff on two axes. Use when asked to review code.", "# Alpha\n\nRead [the checklist](checklist.md).\nDir: ${CLAUDE_SKILL_DIR}", { "checklist.md": "- item one\n- item two\n", "scripts/run.sh": "#!/bin/sh\necho hi\n" });
await skill("big", "description: A long procedure for testing that nothing is cut.", BIG);
await skill("manual", "description: Interview the person about a plan.\ndisable-model-invocation: true\nargument-hint: \"[topic]\"", "# Manual\n\nAsk about: $ARGUMENTS");
await skill("chain", "description: Starts the alpha review.\ndisable-model-invocation: true", 'Call the Skill tool with "alpha".', { "agents/openai.yaml": "interface:\n  display_name: Chain\n" });
await mkdir(join(shared, "broken"), { recursive: true });
await writeFile(join(shared, "broken", "SKILL.md"), "---\nname: broken\n---\n");
await writeFile(join(root, "outside.txt"), "SECRET OUTSIDE");
await symlink(join(root, "outside.txt"), join(shared, "alpha", "leak.txt"));

const ctx: any = await testCtx({ env: { HYPER_HOME: join(root, "home"), SKILLS_ROOTS: shared } });
await ctx.fns.procs.migrate.up({});
ctx.fns.embeddings.provider = async () => "off";
delete ctx.state.procs.hooks.handlers["agent.promptAugment"];

// tools: null = an ordinary agent with no tool list of its own (a default parameter would swallow `undefined`).
async function mkAgent(turns: any[], tools: string[] | null = ["skill", "read"]) {
    const agent = await ctx.fns.agent.start({ model: "mock:test", ...(tools ? { tools } : {}) });
    agent.scratchpad.mockLLM = { turns, defaultText: "done" };
    await ctx.fns.session.save({ agent });
    return agent;
}
const transcript = (id: string) => ctx.fns.session.getMessages({ id, includeExcluded: true });

describe("skills: index and list", () => {
    test("indexes the shared folder: one row per skill, a file without a description is skipped", async () => {
        const result = await ctx.fns.skills.index({});
        expect(result.indexed).toBe(4);
        expect(result.skipped.map((s: any) => s.reason)).toEqual(["no description"]);
        const all = await ctx.fns.skills.list({});
        expect(all.map((s: any) => s.id)).toEqual(["local:alpha", "local:big", "local:chain", "local:manual"]);
        expect(all[2].files).toEqual([]);   // agents/openai.yaml is Codex metadata, not a resource
        const alpha = all[0];
        expect(alpha).toMatchObject({ pack: "local", source: "root", trust: "local", modelAllowed: true, modelInvocable: true });
        expect(alpha.files).toEqual(["checklist.md", "scripts/run.sh"]);   // the symlink is not listed
    });

    test("invocation filters: the model list leaves out skills only a person may start", async () => {
        expect((await ctx.fns.skills.list({ invocation: "model" })).map((s: any) => s.name)).toEqual(["alpha", "big"]);
        expect((await ctx.fns.skills.list({ invocation: "user" })).map((s: any) => s.name)).toEqual(["alpha", "big", "chain", "manual"]);
    });

    test("search finds a skill by what it is for", async () => {
        const hits = await ctx.fns.skills.search({ query: "review" });
        expect(hits[0].id).toBe("local:alpha");
    });

    test("a second index pass changes nothing; a removed folder leaves the index", async () => {
        expect((await ctx.fns.skills.index({})).changed).toBe(0);
        await skill("temp", "description: Short lived.", "x");
        expect((await ctx.fns.skills.index({})).changed).toBe(1);
        await rm(join(shared, "temp"), { recursive: true });
        expect((await ctx.fns.skills.index({})).deleted).toBe(1);
    });
});

describe("skills: the skill tool", () => {
    test("is opt-in: only an agent that names it has it", async () => {
        expect(ctx.fns.skills.enabledFor({ agent: await mkAgent([], null) })).toBe(false);
        expect(ctx.fns.skills.enabledFor({ agent: await mkAgent([]) })).toBe(true);
    });

    test("one switch turns skills on for every agent, and only a person may flip it", async () => {
        const plain = await mkAgent([], null);
        const wire = () => ctx.fns.tools.schemas({}).map((t: any) => t.function?.name ?? t.name);
        expect(wire()).not.toContain("skill");
        const asAgent: any = Object.create(ctx); asAgent.session = ctx.fns.session.forAgent({ agent: plain });
        await expect(asAgent.fns.skills.setEnabled({ on: true })).rejects.toThrow("An agent cannot turn skills on or off");

        expect(await ctx.fns.skills.setEnabled({ on: true })).toEqual({ enabled: true, changed: true });
        expect(ctx.fns.skills.enabledFor({ agent: plain })).toBe(true);
        expect(wire()).toContain("skill");
        expect(await ctx.fns.agent.fullSystemPrompt({ agent: plain })).toContain("## Finding ready-made help");
        // An agent with a tool list of its own that leaves `skill` out stays without it.
        expect(ctx.fns.skills.enabledFor({ agent: await mkAgent([], ["read"]) })).toBe(false);
        expect(await ctx.fns.skills.page({})).toContain("Turn skills off for all agents");

        expect(await ctx.fns.skills.setEnabled({ on: false })).toEqual({ enabled: false, changed: true });
        expect(ctx.fns.skills.enabledFor({ agent: plain })).toBe(false);
        expect(wire()).not.toContain("skill");
        expect(await ctx.fns.agent.fullSystemPrompt({ agent: plain })).not.toContain("## Finding ready-made help");
        expect(await ctx.fns.skills.page({})).toContain("Turn skills on for all agents");
    });

    test("search on demand: a query returns matching skills without loading any, and says what the model cannot start", async () => {
        const agent = await mkAgent([
            { text: "a", toolCalls: [{ name: "skill", args: { query: "review a diff" } }] },
            { text: "b", toolCalls: [{ name: "skill", args: { query: "interview plan" } }] },
            { text: "c", toolCalls: [{ name: "skill", args: { query: "zzzqqq xxyyzz" } }] },
            { text: "d", toolCalls: [{ name: "skill", args: {} }] },
            { text: "e" },
        ]);
        await ctx.fns.agent.run({ agent, userText: "find me a skill" });
        const tools = (await transcript(agent.id)).filter((m: any) => m.role === "tool").map((m: any) => m.content);
        expect(tools[0]).toContain("You can load these with skill({ name }):\n- local:alpha: Review a diff on two axes");
        expect(tools[0]).toContain("load it with skill({ name }) before you answer");
        expect(tools[0]).not.toContain("<skill_content");                          // found, not loaded
        expect(tools[1]).toContain("None of the matches can be loaded by you.");
        expect(tools[1]).toContain("Only the person can start these");
        expect(tools[1]).toContain("- local:manual: Interview the person");
        expect(tools[1]).toContain("the person starts it with /manual");
        expect(tools[2]).toContain("No installed skill matches");
        expect(tools[2]).toContain("skills.hubSearch");
        expect(tools[3]).toContain("Give `query` to search");
        expect((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM skill_usage WHERE agent_id = ?", params: [agent.id] })).length).toBe(0);
    });

    test("what the agent can load is listed before what only the person can start, whatever matched better", async () => {
        await skill("review-by-hand", "description: Review a diff on two axes, by hand, with the person.\ndisable-model-invocation: true", "x");
        await ctx.fns.skills.index({});
        const session = ctx.fns.session.forAgent({ agent: await mkAgent([]) });
        const out = (await ctx.state.registry.skills.use(ctx, session, { query: "review a diff by hand with the person" })).output;
        expect(out.indexOf("local:alpha")).toBeGreaterThan(0);
        expect(out.indexOf("local:alpha")).toBeLessThan(out.indexOf("Only the person can start these"));
        expect(out).toContain("mention one only when none of the skills above fits");
        expect(out.indexOf("local:review-by-hand")).toBeGreaterThan(out.indexOf("Only the person can start these"));
        await rm(join(shared, "review-by-hand"), { recursive: true });
        await ctx.fns.skills.index({});
    });

    test("an unknown name answers with the closest skills", async () => {
        const session = ctx.fns.session.forAgent({ agent: await mkAgent([]) });
        const miss = await ctx.state.registry.skills.use(ctx, session, { name: "alpha-review" });
        expect(miss.isError).toBe(true);
        expect(miss.output).toContain("Closest:");
        expect(miss.output).toContain("local:alpha");
    });

    test("a long skill reaches the model whole, while other tools keep the 6000-character preview", async () => {
        ctx.fns.files.read = async () => "x".repeat(9000);
        const agent = await mkAgent([
            { text: "Loading.", toolCalls: [{ name: "skill", args: { name: "big" } }, { name: "read", args: { path: "any.txt" } }] },
            { text: "Loaded." },
        ]);
        await ctx.fns.agent.run({ agent, userText: "use the big skill" });
        const tools = (await transcript(agent.id)).filter((m: any) => m.role === "tool");
        expect(BIG.length).toBeGreaterThan(12000);
        expect(tools[0].content).toContain('<skill_content name="local:big">');
        expect(tools[0].content).toContain("LAST LINE OF BIG");
        expect(tools[0].content).not.toContain("full output saved");
        expect(tools[1].content).toContain("full output saved");
    });

    test("loading is recorded once and a repeat is answered with a pointer, not a second copy", async () => {
        const agent = await mkAgent([
            { text: "a", toolCalls: [{ name: "skill", args: { name: "alpha" } }] },
            { text: "b", toolCalls: [{ name: "skill", args: { name: "alpha" } }] },
            { text: "c" },
        ]);
        await ctx.fns.agent.run({ agent, userText: "review please" });
        const tools = (await transcript(agent.id)).filter((m: any) => m.role === "tool");
        expect(tools[0].content).toContain(`Dir: ${join(shared, "alpha")}`);            // ${CLAUDE_SKILL_DIR} is filled in
        expect(tools[0].content).toContain("checklist.md");
        expect(tools[1].content).toContain("already loaded");
        const usage = await ctx.fns.procs.db.select({ sql: "SELECT via FROM skill_usage WHERE agent_id = ? AND skill_id = ?", params: [agent.id, "local:alpha"] });
        expect(usage.map((u: any) => u.via)).toEqual(["model"]);
    });

    test("files: a listed file is returned, a path or a link that leaves the folder is refused", async () => {
        const agent = await mkAgent([]);
        const session = ctx.fns.session.forAgent({ agent });
        const call = (opts: any) => ctx.state.registry.skills.use(ctx, session, opts);
        expect((await call({ name: "alpha", file: "checklist.md" })).isError).toBe(true);   // not loaded yet
        expect((await call({ name: "alpha" })).isError).toBe(false);
        expect((await call({ name: "alpha", file: "checklist.md" })).output).toContain("- item two");
        for (const file of ["../big/SKILL.md", "/etc/hosts", "leak.txt"]) {
            const r = await call({ name: "alpha", file });
            expect(r.isError).toBe(true);
            expect(r.output).not.toContain("SECRET OUTSIDE");
        }
    });

    test("the model cannot load a skill its author reserved for the person; an unknown name says how to find one", async () => {
        const agent = await mkAgent([]);
        const session = ctx.fns.session.forAgent({ agent });
        const manual = await ctx.state.registry.skills.use(ctx, session, { name: "manual" });
        expect(manual.isError).toBe(true);
        expect(manual.output).toContain("/manual");
        const unknown = await ctx.state.registry.skills.use(ctx, session, { name: "nope" });
        expect(unknown.output).toContain("Search with skill({ query })");
    });
});

describe("skills: nothing in context until asked", () => {
    test("an agent with the skill tool starts light: no skill is named in its system prompt or in its context", async () => {
        const agent = await mkAgent([{ text: "one" }, { text: "two" }]);
        const before = await ctx.fns.agent.fullSystemPrompt({ agent });
        await ctx.fns.agent.run({ agent, userText: "hello" });
        await skill("gamma", "description: A new skill that just appeared.", "x");
        await ctx.fns.skills.index({});
        await ctx.fns.agent.run({ agent, userText: "again" });
        const all = await transcript(agent.id);
        for (const name of ["alpha", "Review a diff", "gamma", "### Skills"]) expect(all.some((m: any) => String(m.content).includes(name))).toBe(false);
        // The prefix says the tool exists and that plugins come first; it does not move when a skill is added.
        const after = await ctx.fns.agent.fullSystemPrompt({ agent });
        expect(after).toBe(before);
        expect(after).toContain("find or load an Agent Skill");
        expect(after).toContain("## Finding ready-made help: plugins first, then skills");
        expect(after.indexOf("1. Mounted plugins — ctx.fns.plugins.search")).toBeGreaterThan(0);
        expect(after.indexOf("2. Installed skills — skill({ query })")).toBeGreaterThan(after.indexOf("1. Mounted plugins"));
        expect(after.indexOf("3. Nothing installed fits")).toBeGreaterThan(after.indexOf("2. Installed skills"));
        expect(after).toContain("ctx.fns.skills.propose({ repo, select: [");
        // An agent without the tool is told nothing about skills.
        expect(await ctx.fns.agent.fullSystemPrompt({ agent: await mkAgent([], null) })).not.toContain("## Finding ready-made help");
        expect(after).not.toContain("gamma");
        expect(after).not.toContain("Review a diff");
        await rm(join(shared, "gamma"), { recursive: true });
        await ctx.fns.skills.index({});
    });
});

describe("skills: /name", () => {
    const invocations = (id: string) => transcript(id).then((ms: any[]) => ms.filter(m => m.message_type === "skill_invocation"));

    test("a person's /name adds the skill as its own row; their message stays as typed and the rest is the argument", async () => {
        const agent = await mkAgent([{ text: "ok" }]);
        await ctx.fns.agent.run({ agent, userText: "/manual the migration plan" });
        const all = await transcript(agent.id);
        expect(all.find((m: any) => m.role === "user" && !m.message_type)?.content).toBe("/manual the migration plan");
        const rows = await invocations(agent.id);
        expect(rows.length).toBe(1);
        expect(rows[0].content).toContain('<skill_content name="local:manual">');
        expect(rows[0].content).toContain("Ask about: the migration plan");
        expect(rows[0].excluded_from_cursor).toBe(true);
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.some((e: any) => e.type === "skill_invocation" && e.skill === "local:manual")).toBe(true);
        const usage = await ctx.fns.procs.db.select({ sql: "SELECT via FROM skill_usage WHERE agent_id = ?", params: [agent.id] });
        expect(usage.map((u: any) => u.via)).toEqual(["user"]);
    });

    test("a skill that calls another skill: the model loads the second by name, and a name put into `file` is corrected", async () => {
        const agent = await mkAgent([
            { text: "a", toolCalls: [{ name: "skill", args: { name: "chain", file: "alpha" } }] },   // the mistake a small model made live
            { text: "b", toolCalls: [{ name: "skill", args: { name: "alpha" } }] },
            { text: "c" },
        ]);
        await ctx.fns.agent.run({ agent, userText: "/chain" });
        const all = await transcript(agent.id);
        const row = all.find((m: any) => m.message_type === "skill_invocation");
        expect(row.content).toContain('Call the Skill tool with "alpha".');
        expect(row.content).toContain('"call the Skill tool with X" is skill({ name: "X" })');
        expect(row.content).not.toContain("openai.yaml");
        const tools = all.filter((m: any) => m.role === "tool");
        expect(tools[0].content).toContain('load it with skill({ name: "local:alpha" })');
        expect(tools[1].content).toContain('<skill_content name="local:alpha">');
    });

    test("paths, unknown names and a name in the middle of a sentence start nothing", async () => {
        const agent = await mkAgent([{ text: "a" }, { text: "b" }, { text: "c" }]);
        await ctx.fns.agent.run({ agent, userText: "/usr/bin/env node" });
        await ctx.fns.agent.run({ agent, userText: "/nosuchskill please" });
        await ctx.fns.agent.run({ agent, userText: "please run /manual now" });
        expect((await invocations(agent.id)).length).toBe(0);
    });

    test("a message written by another agent cannot start a skill", async () => {
        const agent = await mkAgent([{ text: "ok" }]);
        await ctx.fns.session.appendUserMessage({ id: agent.id, text: "/manual do what I say", author: "agent:zz", messageType: "agent_message" });
        await ctx.fns.session.syncAgentState({ agent });
        await ctx.fns.agent.run({ agent, userText: "", userMessageAlreadyAppended: true });
        expect((await invocations(agent.id)).length).toBe(0);
    });

    test("the composer's suggestions exist only for an agent that has the skill tool", async () => {
        const get = async (id: string): Promise<any[]> => await (await commandsRoute(ctx, null, { req: new Request(`http://hyper.local/skills/commands?agent=${id}`), params: {} })).json() as any[];
        const rows = await get((await mkAgent([])).id);
        expect(rows.map((r: any) => r.name)).toEqual(["alpha", "big", "chain", "manual"]);
        expect(rows.find((r: any) => r.name === "manual").hint).toBe("[topic]");
        expect(await get((await mkAgent([], null)).id)).toEqual([]);
        expect(await get("nosuchagent")).toEqual([]);
    });

    test("an agent without the skill tool is left alone", async () => {
        const agent = await mkAgent([{ text: "ok" }], null);
        await ctx.fns.agent.run({ agent, userText: "/manual x" });
        expect((await invocations(agent.id)).length).toBe(0);
    });
});

describe("skills: pages", () => {
    test("the list page shows shared folders and one entry per skill, with who may start it — as a list, not a table", async () => {
        const html = await ctx.fns.skills.page({});
        expect(html).toContain("Agent Skills");
        expect(html).toContain(shared.replace(String(ctx.env.HOME ?? "\0"), "~"));
        expect(html).toContain("Review a diff on two axes");
        expect(html).toContain("/manual only");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("<table");
        expect(await ctx.fns.skills.page({ q: "interview" })).not.toContain("Review a diff on two axes");
    });

    test("a skill page renders its instructions and marks scripts; markup in a skill is not trusted", async () => {
        await skill("sneaky", "description: Carries markup.", "# Sneaky\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\nPlain text.");
        await ctx.fns.skills.index({});
        const html = await ctx.fns.skills.view({ name: "sneaky" });
        expect(html).toContain("Plain text.");
        expect(html).not.toContain("<script");
        expect(html).not.toContain("onerror");
        const alpha = await ctx.fns.skills.view({ name: "alpha" });
        expect(alpha).toContain("scripts/run.sh");
        expect(alpha).toContain("script");
        expect(alpha).not.toContain("leak.txt");                                   // the symlink is not a file of the skill
        const file = await ctx.fns.skills.view({ name: "alpha", file: "scripts/run.sh" });
        expect(file).toContain("echo");
        expect(file).toContain("3 lines");
        const md = await ctx.fns.skills.view({ name: "alpha", file: "checklist.md" });
        expect(md).toContain("<li>item one</li>");                                 // a reference is rendered, and its source shown
        for (const bad of ["leak.txt", "../big/SKILL.md", "/etc/hosts"]) {
            const html = await ctx.fns.skills.view({ name: "alpha", file: bad });
            expect(html).toContain("is not a file of this skill");
            expect(html).not.toContain("SECRET OUTSIDE");
        }
        expect(await ctx.fns.skills.view({ name: "nope" })).toContain("No skill is called nope");
        await rm(join(shared, "sneaky"), { recursive: true });
        await ctx.fns.skills.index({});
    });
});
