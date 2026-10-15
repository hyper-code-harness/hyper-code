import { test, expect, describe } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.load", () => {
    test("returns null when id unknown", async () => {
        const ctx: any = await mkTestCtx();
        expect(await ctx.fns.session.load({ id: "nope" })).toBeNull();
    });

    test("round-trip: save → load reconstructs agent shape", async () => {
        const ctx: any = await mkTestCtx();
        const original = await ctx.fns.agent.start({ model: "m", systemPrompt: "sp" });
        original.scratchpad.note = 'remember';
        await ctx.fns.session.save({ agent: original });
        await ctx.fns.session.replaceMessages({ id: original.id, messages: [
            { role: 'user', content: 'a' },
            { role: 'assistant', content: '§eval\nconsole.log(1);' },
            { role: 'user', content: '§result:eval\n1' },
        ] });
        await ctx.fns.session.replaceEvents({ id: original.id, events: [
            { type: 'user', text: 'a' },
            { type: 'tool_call', name: 'eval', args: { code: 'console.log(1);' }, result: '1' },
        ] });

        // fresh ctx, same db — simulate restart by sharing the pg pool (the
        // pg_temp schema follows the connection).
        const ctx2: any = await mkTestCtx();
        ctx2.state.procs ??= {};
        ctx2.state.procs.db ??= {};
        (ctx2.state as any).procs.db.sql = await ctx.fns.procs.db.conn();
        const loaded = await ctx2.fns.session.load({ id: original.id });
        expect(loaded).not.toBeNull();
        expect(loaded!.id).toBe(original.id);
        expect(loaded!.model).toBe("m");
        expect(loaded!.systemPrompt).toBe("sp");
        expect(loaded!.messages).toEqual([
            { role: 'user', content: 'a', idx: 0 },
            { role: 'assistant', content: '§eval\nconsole.log(1);', idx: 1 },
            { role: 'user', content: '§result:eval\n1', idx: 2 },
        ]);
        expect(loaded!.events).toMatchObject([   // co's feature adds ts to every event
            { type: 'user', text: 'a' },
            { type: 'tool_call', name: 'eval', args: { code: 'console.log(1);' }, result: '1' },
        ]);
        expect(loaded!.scratchpad).toEqual({ note: "remember" });
        expect(loaded!.isStreaming).toBe(false);
    });
});
