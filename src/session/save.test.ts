import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// mkTestCtx uses migrated, isolated Postgres on the test server, not a SQL mock.
const history = async (ctx: any, id: string) => ({
    messages: await ctx.fns.procs.db.select({ sql: "SELECT * FROM messages WHERE agent_id = ? ORDER BY idx", params: [id] }),
    events: await ctx.fns.procs.db.select({ sql: "SELECT * FROM events WHERE agent_id = ? ORDER BY idx", params: [id] }),
});

describe("session.save", () => {
    test("upserts agent state and plans without importing in-memory history", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "m1", systemPrompt: "sp" });
        agent.scratchpad = { x: 42, plan: { title: "Keep", tasks: [] } };
        agent.functionRagEnabled = true;
        // A detached import object is not a live transcript mutation.
        await ctx.fns.session.save({ agent: { ...agent, messages: [{ role: "user", content: "not imported" }], events: [{ type: "user", text: "not imported" }] } });
        const loaded = await ctx.fns.session.load({ id: agent.id });
        expect(loaded.model).toBe("m1");
        expect(loaded.systemPrompt).toBe("sp");
        expect(loaded.scratchpad).toEqual(agent.scratchpad);
        expect(loaded.functionRagEnabled).toBe(true);
        expect(await history(ctx, agent.id)).toEqual({ messages: [], events: [] });
    });

    test("stale save preserves every durable message and event column, including result_ref", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "m" });
        const stale = await ctx.fns.session.load({ id: agent.id });
        const ref = { version: 1, id: "123e4567-e89b-42d3-a456-426614174000", ownerAgentId: agent.id, bytes: 12000, sha256: "a".repeat(64), kind: "text" };
        await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "tool", content: "preview", tool_call_id: "tc", excluded_from_cursor: true, excluded_from_llm: true, author: "tester", result_ref: ref } });
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "tool_result", actor: "tester", text: "preview" }, ts: 123456 });
        const before = await history(ctx, agent.id);
        expect(before.messages).toHaveLength(1);
        expect(before.messages[0].result_ref).toBeTruthy();
        stale.title = "new title";
        await ctx.fns.session.save({ agent: stale });
        expect(await history(ctx, agent.id)).toEqual(before);
        expect((await ctx.fns.session.load({ id: agent.id })).title).toBe("new title");
    });

    test("append interleaved inside a state save survives, then concurrent saves and appends retain all rows", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "m" });
        const run = ctx.state.registry.procs.db.run;
        let entered!: () => void, release!: () => void;
        const waiting = new Promise<void>(resolve => { entered = resolve; });
        const barrier = new Promise<void>(resolve => { release = resolve; });
        ctx.state.registry.procs.db.run = async (c: any, s: any, o: any) => {
            const result = await run(c, s, o);
            if (o.sql.includes("INSERT INTO agents")) { entered(); await barrier; }
            return result;
        };
        const saving = ctx.fns.session.save({ agent });
        try {
            await waiting;
            await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "during save" } });
            await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "user", text: "during save" } });
        } finally { release(); await saving; ctx.state.registry.procs.db.run = run; }
        expect((await history(ctx, agent.id)).messages).toHaveLength(1);
        expect((await history(ctx, agent.id)).events).toHaveLength(1);
        await Promise.all(Array.from({ length: 8 }, async (_, i) => {
            await ctx.fns.session.save({ agent });
            await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: `parallel ${i}` } });
            await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "user", text: `parallel ${i}` } });
        }));
        const after = await history(ctx, agent.id);
        expect(after.messages).toHaveLength(9);
        expect(after.events).toHaveLength(9);
    });

    test("explicit import/copy and replacement persist history; a synchronized fork never copies inherited rows on save", async () => {
        const ctx: any = await mkTestCtx();
        const parent = await ctx.fns.agent.start({ model: "m" });
        await ctx.fns.session.replaceMessages({ id: parent.id, messages: [{ role: "user", content: "imported" }] });
        await ctx.fns.session.replaceEvents({ id: parent.id, events: [{ type: "user", text: "imported" }] });
        const exported = await ctx.fns.session.load({ id: parent.id });
        const copy = await ctx.fns.agent.start({ model: exported.model });
        await ctx.fns.session.replaceMessages({ id: copy.id, messages: exported.messages });
        await ctx.fns.session.replaceEvents({ id: copy.id, events: exported.events });
        await ctx.fns.session.save({ agent: copy });
        expect((await ctx.fns.session.load({ id: copy.id })).messages[0].content).toBe("imported");
        expect((await ctx.fns.session.load({ id: copy.id })).events[0].text).toBe("imported");
        const child = await ctx.fns.session.fork({ id: parent.id });
        await ctx.fns.session.appendMessage({ id: child.id, message: { role: "user", content: "own" } });
        await ctx.fns.session.syncAgentState({ agent: child });
        expect(child.messages).toHaveLength(2);
        const before = await history(ctx, child.id);
        await ctx.fns.session.save({ agent: child });
        expect(await history(ctx, child.id)).toEqual(before);
        expect((await ctx.fns.session.getMessages({ id: child.id }))).toHaveLength(1);
        expect((await ctx.fns.session.load({ id: child.id })).messages).toHaveLength(2);
    });
});
