import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent schedules", () => {
    test("creates, lists, runs and removes a recurring prompt", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        const body = new FormData(); body.set("action", "add"); body.set("text", "Review progress"); body.set("every", "1h");
        const created = await ctx.fns.procs.http.dispatch({ method: "POST", url: `/agent/${agent.id}/schedules`, body });
        expect(created.status).toBe(204);
        const tasks = await ctx.fns.agent.listSchedules({ agentId: agent.id });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].fn).toBe("agent.injectScheduledPrompt");
        expect(tasks[0].args).toMatchObject({ agentId: agent.id, text: "Review progress" });
        await ctx.fns.cron.runNow({ name: tasks[0].name });
        const claimed = await ctx.fns.cron.claim({ now: Date.now() + 1 });
        expect(claimed).toBeTruthy();
        await ctx.fns.cron.runOne({ id: Number(claimed.id) });
        expect((await ctx.fns.session.getMessages({ id: agent.id })).at(-1)).toMatchObject({ role: "user", content: "Review progress" });
        await ctx.fns.cron.remove({ name: tasks[0].name });
        expect(await ctx.fns.agent.listSchedules({ agentId: agent.id })).toEqual([]);
    });
});
