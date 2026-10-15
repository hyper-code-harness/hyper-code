import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.loadAll", () => {
    test("empty db → {loaded: 0}", async () => {
        const ctx: any = await mkTestCtx();
        expect((await ctx.fns.session.loadAll({})).loaded).toBe(0);
    });

    test("rehydrates every saved agent into ctx.state.agent", async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.renderEventHtml = async (_c: any, _s: any, _o: any) => '';
        const a = await ctx.fns.agent.start({ model: "m1" });
        await ctx.fns.session.save({ agent: a });
        await ctx.fns.session.appendUserMessage({ id: a.id, text: 'hi' });
        const b = await ctx.fns.agent.start({ model: "m2", systemPrompt: "sp" });
        await ctx.fns.session.save({ agent: b });

        // fresh ctx, same db — simulate restart by sharing the pg pool (the
        // pg_temp schema follows the connection).
        const ctx2: any = await mkTestCtx();
        ((ctx2.state as any).procs ??= {}).db = { ...((ctx2.state as any).procs.db ?? {}), sql: await ctx.fns.procs.db.conn({}) };
        const res = await ctx2.fns.session.loadAll({});
        expect(res.loaded).toBe(2);
        expect((ctx2.state as any).agent[a.id].messages).toEqual([{ role: "user", content: "hi", idx: 0 }]);
        expect((ctx2.state as any).agent[b.id].systemPrompt).toBe("sp");
    });
});
