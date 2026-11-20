// Start / Continue of a waiting plan: the agent is told to take the current task.
import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

test("continuing a waiting plan resumes it and queues the current task for the agent as an ordinary message", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    await expect(ctx.fns.agent.continuePlan({ agent })).rejects.toThrow("this chat has no plan");

    // Tasks written by hand while the agent is idle: the plan waits.
    await ctx.fns.session.editPlanTask({ agent, action: "add", title: "Write the text" });
    await ctx.fns.session.editPlanTask({ agent, action: "add", title: "Publish" });
    expect(agent.scratchpad.plan.pausedAt).toBeGreaterThan(0);

    // A later run is already scheduled (a wake set for tomorrow): Start still means now.
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = ? WHERE id = ?", params: [Date.now() + 86_400_000, agent.id] });
    expect(await ctx.fns.agent.continuePlan({ agent })).toEqual({ ok: true, task: { id: "task-1", title: "Write the text" } });
    expect(agent.scratchpad.plan.pausedAt).toBeNull();
    expect(agent.scratchpad.plan.tasks[0]).toMatchObject({ status: "active" });
    expect(agent.scratchpad.plan.tasks[0].activeSince).toBeGreaterThan(0);
    const messages = await ctx.fns.session.getMessages({ id: agent.id });
    const last = messages[messages.length - 1];
    expect(last).toMatchObject({ role: "user" });
    expect(String(last.content)).toContain("Continue the active plan task.");
    expect(String(last.content)).toContain("Task ID: task-1");
    expect(String(last.content)).toContain('session.done({ agent, id: "task-1" })');
    // The worker has something to pick up.
    const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id = ?", params: [agent.id] }))[0];
    expect(Number(row.next_run_at)).toBeGreaterThan(0);
    expect(Number(row.next_run_at)).toBeLessThanOrEqual(Date.now());

    // Nothing left to do: it says so instead of waking the agent for nothing.
    await ctx.fns.session.done({ agent, id: "task-1" });
    await ctx.fns.session.done({ agent, id: "task-2" });
    await expect(ctx.fns.agent.continuePlan({ agent })).rejects.toThrow("every task is done");
});
