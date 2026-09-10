import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("agent.autoCompactIfNeeded", () => {
    test("compacts an oversized idle Codex agent", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "codex:gpt-test" });
        await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: "x".repeat(50_000) } });
        await ctx.fns.session.syncAgentState({ agent });
        let calls = 0;
        ctx.state.registry.agent.compactContext = async () => { calls++; return { status: "compacted", tokensBefore: 12_500 }; };
        const result = await ctx.fns.agent.autoCompactIfNeeded({ agent, thresholdTokens: 10_000 });
        expect(result.status).toBe("compacted");
        expect(calls).toBe(1);
    });

    test("skips non-Codex and below-threshold agents", async () => {
        const ctx: any = await mkTestCtx();
        const local = await ctx.fns.agent.start({ model: "mock:test" });
        expect((await ctx.fns.agent.autoCompactIfNeeded({ agent: local, thresholdTokens: 10_000 })).status).toBe("not_codex");
        const codex = await ctx.fns.agent.start({ model: "codex:gpt-test" });
        await ctx.fns.session.appendMessage({ id: codex.id, message: { role: "user", content: "small" } });
        await ctx.fns.session.syncAgentState({ agent: codex });
        expect((await ctx.fns.agent.autoCompactIfNeeded({ agent: codex, thresholdTokens: 10_000 })).status).toBe("below_threshold");
    });
});
