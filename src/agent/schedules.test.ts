import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("legacy agent schedules", () => {
  test("creates, lists, runs and cancels a unified cron trigger", async () => {
    const ctx: any = await mkTestCtx();
    const agent = await ctx.fns.agent.start({ model: "mock:test" });
    const body = new FormData(); body.set("action", "add"); body.set("text", "Review progress"); body.set("every", "1h");
    const created = await ctx.fns.procs.http.dispatch({ method: "POST", url: `/agent/${agent.id}/schedules`, body });
    expect(created.status).toBe(204);
    const tasks = await ctx.fns.agent.listSchedules({ agentId: agent.id });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].fn).toBe("agent.injectScheduledPrompt");
    expect(tasks[0].args).toMatchObject({ agentId: agent.id, text: "Review progress" });
    await ctx.fns.procs.db.run({ sql: "UPDATE agent_triggers SET next_at=? WHERE id=?", params: [Date.now(), tasks[0].name] });
    await ctx.fns.agent.pollTriggers({ now: Date.now() + 1 });
    await Bun.sleep(30);
    expect((await ctx.fns.session.getMessages({ id: agent.id })).at(-1)).toMatchObject({ role: "user", content: "Review progress" });
    expect((await ctx.fns.agent.cancelTrigger({ id: agent.id, triggerId: tasks[0].name })).cancelled).toBe(true);
    expect(await ctx.fns.agent.listSchedules({ agentId: agent.id })).toHaveLength(1);
  });
});
