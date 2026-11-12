import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.pausePlan", () => {
    test("pauses once, freezes the active timer and lists the steps left", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.session.plan({ agent, tasks: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] });
        await ctx.fns.session.done({ agent, id: "a" });
        const first = await ctx.fns.session.pausePlan({ agent, reason: "limit", note: "Agent stopped: no progress." });
        expect(first.paused).toBe(true);
        expect(first.remaining.map((t: any) => t.id)).toEqual(["b", "c"]);
        expect(agent.scratchpad.plan).toMatchObject({ pauseReason: "limit", pauseNote: "Agent stopped: no progress." });
        expect(agent.scratchpad.plan.tasks[1].activeSince).toBeNull();
        expect((await ctx.fns.session.pausePlan({ agent })).paused).toBe(false);
        await ctx.fns.session.done({ agent, id: "b" });
        expect(agent.scratchpad.plan.pausedAt).toBeNull();
        expect(agent.scratchpad.plan.pauseReason).toBeUndefined();
    });

    test("no plan is a no-op", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        expect(await ctx.fns.session.pausePlan({ agent })).toEqual({ paused: false, remaining: [] });
    });
});
