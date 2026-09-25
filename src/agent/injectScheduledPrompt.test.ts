import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent.injectScheduledPrompt", () => {
    test("appends a real user message and schedules the agent", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "mock:test" });
        const result = await ctx.fns.agent.injectScheduledPrompt({ agentId: agent.id, text: "Review progress", scheduleId: "daily" });
        expect(result.scheduled).toBe(true);
        const messages = await ctx.fns.session.getMessages({ id: agent.id });
        expect(messages.at(-1)).toMatchObject({ role: "user", content: "Review progress" });
        expect(messages.at(-1).excluded_from_cursor).not.toBe(true);
        const row = (await ctx.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id=?", params: [agent.id] }))[0] as any;
        expect(Number(row.next_run_at)).toBeGreaterThan(0);
    });
});
