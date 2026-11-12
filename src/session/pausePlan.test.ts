import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("session.pausePlan / resumePlan", () => {
    test("the agent's pause needs a reason, freezes the timer, lists the steps left and writes a chat event", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.session.plan({ agent, tasks: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }] });
        await ctx.fns.session.done({ agent, id: "a" });
        expect(ctx.fns.session.pausePlan({ agent })).rejects.toThrow("reason is required");

        const first = await ctx.fns.session.pausePlan({ agent, reason: "Waiting for approval" });
        expect(first.paused).toBe(true);
        expect(first.remaining.map((t: any) => t.id)).toEqual(["b", "c"]);
        expect(agent.scratchpad.plan).toMatchObject({ pausedBy: "agent", pauseReason: "Waiting for approval" });
        expect(agent.scratchpad.plan.tasks[1].activeSince).toBeNull();
        const event = (await ctx.fns.session.getEvents({ id: agent.id })).find((e: any) => e.type === "plan_paused");
        expect(event).toMatchObject({ by: "agent", reason: "Waiting for approval", activeTaskId: "b" });

        // already paused: nothing changes, no second event
        expect((await ctx.fns.session.pausePlan({ agent, reason: "again" })).paused).toBe(false);
        expect((await ctx.fns.session.getEvents({ id: agent.id })).filter((e: any) => e.type === "plan_paused")).toHaveLength(1);

        expect(await ctx.fns.session.resumePlan({ agent })).toEqual({ resumed: true });
        expect(agent.scratchpad.plan.pausedAt).toBeNull();
        expect(agent.scratchpad.plan.pausedBy).toBeUndefined();
        expect(agent.scratchpad.plan.pauseReason).toBeUndefined();
        expect(agent.scratchpad.plan.tasks[1].activeSince).toBeGreaterThan(0);
        expect(await ctx.fns.session.resumePlan({ agent })).toEqual({ resumed: false });
    });

    test("session.done clears a pause; Stop pauses without a second chat line", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        await ctx.fns.session.plan({ agent, tasks: [{ id: "a", title: "A" }, { id: "b", title: "B" }] });
        await ctx.fns.session.pausePlan({ agent, by: "user" });
        expect(agent.scratchpad.plan.pausedBy).toBe("user");
        expect((await ctx.fns.session.getEvents({ id: agent.id })).some((e: any) => e.type === "plan_paused")).toBe(false);
        await ctx.fns.session.done({ agent, id: "a" });
        expect(agent.scratchpad.plan.pausedAt).toBeNull();
        expect(agent.scratchpad.plan.pausedBy).toBeUndefined();
    });

    test("no plan is a no-op", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        expect(await ctx.fns.session.pausePlan({ agent, reason: "x" })).toEqual({ paused: false, remaining: [] });
        expect(await ctx.fns.session.resumePlan({ agent })).toEqual({ resumed: false });
    });
});
