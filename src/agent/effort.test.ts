import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent reasoning effort", () => {
    test("persists preference and reports model-safe applied effort", async () => {
        const ctx:any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "anthropic-oauth:claude-sonnet-4-6" });
        const result = await ctx.fns.agent.setReasoningEffort({ id: agent.id, effort: "xhigh" });
        expect(result).toMatchObject({ requested: "xhigh", applied: "high", downgraded: true });
        expect((await ctx.fns.session.load({ id: agent.id })).reasoningEffort).toBe("xhigh");
    });

    test("HTTP route changes only the selected agent", async () => {
        const ctx:any = await mkTestCtx();
        const one = await ctx.fns.agent.start({ model: "codex:gpt-5.6-sol" });
        const two = await ctx.fns.agent.start({ model: "codex:gpt-5.6-sol" });
        const response = await ctx.fns.procs.http.dispatch({ url: `/agent/${one.id}/effort`, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "effort=high" });
        expect(response.status).toBe(204);
        expect((await ctx.fns.session.load({ id: one.id })).reasoningEffort).toBe("high");
        expect((await ctx.fns.session.load({ id: two.id })).reasoningEffort).toBe("auto");
    });

    test("picker shows only model-supported levels", async () => {
        const ctx:any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "anthropic-oauth:claude-sonnet-4-6" });
        const html = await (await ctx.fns.agent.effortPicker({ agentId: agent.id })).text();
        expect(html).toContain("Reasoning effort");
        expect(html).toContain('value="high"');
        expect(html).not.toContain('value="xhigh"');
        expect(html).toContain(`/agent/${agent.id}/effort`);
        const auto = /<form[^>]*><input[^>]*value="auto"[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1] ?? "";
        expect(auto).toContain('aria-current="true"');
        expect(auto).toContain("ui-button--active");
        expect(auto).not.toContain("disabled");
    });
});
