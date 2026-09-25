import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent automation flags", () => {
    test("retrieval toggles preserve compact context", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        agent.sleepContext = { mode: "compact", activeRevision: 1, draftRevision: null, generations: [{ revision: 1 }] };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ?", params: [JSON.stringify(agent.sleepContext), agent.id] });
        expect(await ctx.fns.agent.setAutomation({ id: agent.id, functionRagEnabled: false, jevRerankEnabled: false })).toEqual({ functionRagEnabled: false, functionRagGateEnabled: false, jevRerankEnabled: false });
        expect(agent.sleepContext.mode).toBe("compact");
        const loaded = await ctx.fns.session.load({ id: agent.id });
        expect(loaded.sleepContext).toEqual(agent.sleepContext);
    });

    test("flags survive reload", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.agent.setAutomation({ id: agent.id, functionRagEnabled: true, jevRerankEnabled: false });
        delete ctx.state.agent[agent.id];
        const loaded = await ctx.fns.session.load({ id: agent.id });
        expect(loaded?.functionRagEnabled).toBe(true);
        expect(loaded?.jevRerankEnabled).toBe(false);
    });

    test("new agents have no removed automation fields", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        expect(agent.reflectionEnabled).toBeUndefined();
        expect(agent.sleepEnabled).toBeUndefined();
        expect(agent.reflection).toBeUndefined();
        const loaded = await ctx.fns.session.load({ id: agent.id });
        expect(loaded?.reflectionEnabled).toBeUndefined();
        expect(loaded?.sleepEnabled).toBeUndefined();
        expect(loaded?.reflection).toBeUndefined();
    });

    test("undefined flags leave the stored values untouched", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.agent.setAutomation({ id: agent.id, functionRagEnabled: true, jevRerankEnabled: false });
        await ctx.fns.agent.setAutomation({ id: agent.id, jevRerankEnabled: true });
        const row = ((await ctx.fns.procs.db.select({ sql: "SELECT function_rag_enabled, jev_rerank_enabled FROM agents WHERE id = ?", params: [agent.id] })) as any[])[0];
        expect(row.function_rag_enabled).toBe(true);
        expect(row.jev_rerank_enabled).toBe(true);
    });
});
