// FUNCTIONAL test: src/input — chat inputs end to end on a real test database:
// open → card in the transcript → submit/cancel → <input-result> wakes the agent.
import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function setup() {
    const ctx: any = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString("base64") } });
    const agent = await ctx.fns.agent.start({ model: "test:model", systemPrompt: "" });
    await ctx.fns.session.save({ agent });
    return { ctx, agent };
}

const lastMessage = async (ctx: any, id: string) => (await ctx.fns.session.getMessages({ id })).at(-1);

describe("input", () => {
    test("kinds are registered and advertised in the system prompt", async () => {
        const { ctx } = await setup();
        expect(ctx.fns.input.kinds({}).map((k: any) => k.name)).toEqual(expect.arrayContaining(["choice", "confirm", "grid", "secret"]));
        expect(ctx.fns.input.promptSection({})).toContain("## Chat inputs");
    });

    test("choice: open card, validation keeps it open, submit wakes the agent", async () => {
        const { ctx, agent } = await setup();
        const out = await ctx.fns.input.request({ agentId: agent.id, kind: "choice", title: "Which?", spec: { options: ["a", { value: "b", label: "Bee" }] } });
        const events = await ctx.fns.session.getEvents({ id: agent.id });
        expect(events.at(-1)).toMatchObject({ type: "input", inputId: out.id });
        const open = await ctx.fns.input.card({ id: out.id });
        expect(open).toContain(`hx-post="/input/${out.id}"`);
        expect(open).toContain('value="b"');

        expect(await ctx.fns.input.submit({ id: out.id, values: {} })).toMatchObject({ state: "open", error: expect.any(String) });
        expect(await ctx.fns.input.submit({ id: out.id, values: { pick: "b" } })).toEqual({ state: "submitted" });
        expect((await ctx.fns.input.get({ id: out.id })).result).toEqual({ value: "b" });
        const msg = await lastMessage(ctx, agent.id);
        expect(msg.role).toBe("user");
        expect(msg.message_type).toBe("input");
        expect(msg.content).toContain(`<input-result id="${out.id}" kind="choice" state="submitted"`);
        expect(msg.content).toContain('chose "Bee"');
        // A second answer is a no-op.
        expect(await ctx.fns.input.submit({ id: out.id, values: { pick: "a" } })).toEqual({ state: "submitted" });
        expect((await ctx.fns.input.get({ id: out.id })).result).toEqual({ value: "b" });
        expect(await ctx.fns.input.card({ id: out.id })).toContain("Bee");
    });

    test("secret: value goes to secret storage, never to the row or transcript", async () => {
        const { ctx, agent } = await setup();
        const out = await ctx.fns.input.request({ agentId: agent.id, kind: "secret", title: "Token", spec: { saveAs: "secret://test/token" } });
        expect(await ctx.fns.input.submit({ id: out.id, values: { value: "s3cr3t-value" } })).toEqual({ state: "submitted" });
        expect(await ctx.fns.secrets.get({ ref: "secret://test/token" })).toBe("s3cr3t-value");
        const rows = await ctx.fns.procs.db.select({ sql: "SELECT * FROM inputs WHERE id = ?", params: [out.id] });
        expect(JSON.stringify(rows)).not.toContain("s3cr3t-value");
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(JSON.stringify(messages)).not.toContain("s3cr3t-value");
        expect((await lastMessage(ctx, agent.id)).content).toContain("secret://test/token");
    });

    test("confirm and cancel", async () => {
        const { ctx, agent } = await setup();
        const yes = await ctx.fns.input.request({ agentId: agent.id, kind: "confirm", title: "Send?", spec: { details: "**hi**" } });
        await ctx.fns.input.submit({ id: yes.id, values: { decision: "no", comment: "later" } });
        expect((await ctx.fns.input.get({ id: yes.id })).result).toEqual({ confirmed: false, comment: "later" });
        const c = await ctx.fns.input.request({ agentId: agent.id, kind: "choice", title: "X", spec: { options: ["1", "2"] } });
        expect(await ctx.fns.input.submit({ id: c.id, cancel: true })).toEqual({ state: "cancelled" });
        expect((await lastMessage(ctx, agent.id)).content).toContain('state="cancelled"');
    });

    test("grid: filter fragment and pick resolves the row", async () => {
        const { ctx, agent } = await setup();
        const rows = [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }, { id: 3, name: "Carol" }];
        const out = await ctx.fns.input.request({ agentId: agent.id, kind: "grid", title: "Who?", spec: { rows } });
        const kind = ctx.state.input.kinds.grid;
        const input = await ctx.fns.input.get({ id: out.id });
        const part = await kind.part(ctx, { input, query: new URLSearchParams("q=bo") });
        expect(part).toContain("Bob");
        expect(part).not.toContain("Alice");
        await ctx.fns.input.submit({ id: out.id, values: { pick: "2" } });
        expect((await ctx.fns.input.get({ id: out.id })).result).toEqual({ value: "2", row: { id: 2, name: "Bob" } });
    });

    test("unknown kind and bad spec are refused before anything is stored", async () => {
        const { ctx, agent } = await setup();
        await expect(ctx.fns.input.request({ agentId: agent.id, kind: "nope", title: "x" })).rejects.toThrow("unknown kind");
        await expect(ctx.fns.input.request({ agentId: agent.id, kind: "choice", title: "x", spec: { options: [] } })).rejects.toThrow("options");
    });
});
