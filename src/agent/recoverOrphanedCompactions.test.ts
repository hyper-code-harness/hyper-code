import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent.recoverOrphanedCompactions", () => {
    test("clears an idle draft owned by a previous process", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        const sleep = { mode: "full", activeRevision: null, draftRevision: 1, draftOwner: "old-process", generations: [{ revision: 1, status: "draft" }] };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context=?::jsonb WHERE id=?", params: [JSON.stringify(sleep), agent.id] });
        (ctx.state as any).compactionOwner = "current-process";
        const result = await ctx.fns.agent.recoverOrphanedCompactions({});
        expect(result.recovered).toEqual([agent.id]);
        const loaded: any = await ctx.fns.session.load({ id: agent.id });
        expect(loaded.sleepContext.draftRevision).toBeNull();
        expect(loaded.sleepContext.generations[0].status).toBe("failed");
    });

    test("keeps a draft owned by this process", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        const sleep = { mode: "full", activeRevision: null, draftRevision: 1, draftOwner: "current-process", generations: [{ revision: 1, status: "draft" }] };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context=?::jsonb WHERE id=?", params: [JSON.stringify(sleep), agent.id] });
        (ctx.state as any).compactionOwner = "current-process";
        expect((await ctx.fns.agent.recoverOrphanedCompactions({})).recovered).toEqual([]);
    });
});
