import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const draft = (over: Record<string, any> = {}) => ({ id: "sp", model: "mock:test", systemPrompt: "", messages: [], events: [], scratchpad: {}, ...over }) as any;

test("built-in full and lean are listed; full is the default base", async () => {
    const ctx: any = await mkTestCtx();
    const names = (await ctx.fns.agent.systemPrompts({})).map((p: any) => p.name);
    expect(names).toEqual(["full", "lean"]);
    const base = await ctx.fns.agent.systemPromptBase({ agent: draft() });
    expect(base.name).toBe("full");
    expect(base.text).toContain("Secret handling");
});

test("lean keeps the safety lines it would otherwise lose", async () => {
    const ctx: any = await mkTestCtx();
    const lean = (await ctx.fns.agent.systemPrompts({ name: "lean" }))[0];
    expect(lean.text).toContain("secrets.list");
    expect(lean.text).toContain("agent.finishTask");
    expect(lean.text).toContain("Never put secrets into memory");
    expect(lean.tokens).toBeLessThan((await ctx.fns.agent.systemPrompts({ name: "full" }))[0].tokens);
});

test("a saved prompt is seen by its person only, and a chat runs on it by name", async () => {
    const ctx: any = await mkTestCtx();
    await ctx.fns.agent.saveSystemPrompt({ name: "reviewer", text: "REVIEWER BASE", userId: "u1" });
    expect((await ctx.fns.agent.systemPrompts({ userId: "u1" })).map((p: any) => p.name)).toContain("reviewer");
    expect((await ctx.fns.agent.systemPrompts({ userId: "u2" })).map((p: any) => p.name)).not.toContain("reviewer");
    const prompt = await ctx.fns.agent.fullSystemPrompt({ agent: draft({ systemPromptName: "reviewer", createdBy: "u1" }) });
    expect(prompt.startsWith("REVIEWER BASE")).toBe(true);
});

test("an unknown name falls back to full and says so; own text wins over a name", async () => {
    const ctx: any = await mkTestCtx();
    const gone = await ctx.fns.agent.systemPromptBase({ agent: draft({ systemPromptName: "deleted" }) });
    expect(gone.name).toBe("full");
    expect(gone.missing).toBe("deleted");
    const own = await ctx.fns.agent.systemPromptBase({ agent: draft({ systemPromptName: "lean", systemPromptCore: "OWN" }) });
    expect(own).toMatchObject({ name: "custom", text: "OWN", source: "custom" });
});

test("built-in names are reserved", async () => {
    const ctx: any = await mkTestCtx();
    await expect(ctx.fns.agent.saveSystemPrompt({ name: "lean", text: "x", userId: "u1" })).rejects.toThrow("built-in");
});

test("start, save and load keep the name; forks inherit it; setSystemPrompt switches it", async () => {
    const ctx: any = await mkTestCtx();
    const a = await ctx.fns.agent.start({ model: "mock:echo", systemPromptName: "lean" });
    const loaded = await ctx.fns.session.load({ id: a.id });
    expect(loaded.systemPromptName).toBe("lean");
    const child = await ctx.fns.session.fork({ id: a.id, offset: 0 });
    expect(child.systemPromptName).toBe("lean");
    await ctx.fns.agent.setSystemPrompt({ id: a.id, name: "full" });
    expect((await ctx.fns.session.load({ id: a.id })).systemPromptName).toBe("full");
    await expect(ctx.fns.agent.setSystemPrompt({ id: a.id, name: "nope" })).rejects.toThrow("no system prompt");
});

test("New agent flow: own text saved under a name is used by name and remembered; a name is validated", async () => {
    const ctx: any = await mkTestCtx();
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: "insert into users (id, email, name, role, created_at, updated_at) values ('ann', 'ann@x', 'ann', 'member', ?, ?) on conflict do nothing", params: [now, now] });
    const ann = Object.create(ctx); ann.session = { kind: "http", user: { id: "ann", role: "member" } };
    const saved = await ann.fns.agent.createFromValues({ title: "own", systemPromptName: "__custom", systemPromptCore: "ANN BASE", saveSystemPromptAs: "ann-base" });
    expect(saved.error).toBeUndefined();
    expect(saved.agent.systemPromptName).toBe("ann-base");
    expect(saved.agent.systemPromptCore).toBe("");
    expect((await ann.fns.agent.fullSystemPrompt({ agent: saved.agent })).startsWith("ANN BASE")).toBe(true);
    expect(await ann.fns.agent.rememberSystemPrompt({ userId: "ann" })).toBe("ann-base");
    expect(await ann.fns.agent.newForm({})).toContain('<option value="ann-base" selected');
    const oneOff = await ann.fns.agent.createFromValues({ title: "once", systemPromptName: "__custom", systemPromptCore: "ONCE" });
    expect(oneOff.agent.systemPromptCore).toBe("ONCE");
    expect((await ann.fns.agent.createFromValues({ title: "bad", systemPromptName: "nope" })).error).toContain("Unknown system prompt");
    expect((await ann.fns.agent.createFromValues({ title: "empty", systemPromptName: "__custom", systemPromptCore: " " })).error).toContain("empty");
});

test("launch paths carry the name: ui.createAgent and the chat popup switch", async () => {
    const ctx: any = await mkTestCtx();
    const made = await ctx.fns.ui.createAgent({ systemPromptName: "lean", open: false });
    expect((await ctx.fns.session.load({ id: made.id })).systemPromptName).toBe("lean");
    const res = await ctx.fns.agent.systemPromptPopup({ agentId: made.id, name: "full" });
    expect(await res.text()).toContain("Switched to full");
    expect((await ctx.fns.session.load({ id: made.id })).systemPromptName).toBe("full");
});
