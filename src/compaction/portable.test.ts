import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const block = { type: "compaction", content: "## Summary\nCodename HERON-3", signature: "sig" };
const claudeCp = { role: "user", content: JSON.stringify(block), message_type: "anthropic_compaction" };
const codexCp = { role: "user", content: JSON.stringify({ type: "compaction", encrypted_content: "x" }), message_type: "codex_compaction" };

describe("compaction.portable", () => {
    test("keeps a native checkpoint for the producing model", async () => {
        const ctx: any = await mkTestCtx();
        expect(ctx.fns.compaction.portable({ model: "claude-code:claude-opus-5", producedBy: "claude-code:claude-opus-5", messages: [claudeCp] })).toEqual([claudeCp]);
        expect(ctx.fns.compaction.portable({ model: "codex:gpt-5", producedBy: "codex:gpt-5", messages: [codexCp] })).toEqual([codexCp]);
    });
    test("turns a Claude block into a text summary for any other model", async () => {
        const ctx: any = await mkTestCtx();
        for (const model of ["claude-code:claude-haiku-4-5", "codex:gpt-5", "lmstudio:qwen"]) {
            const [m] = ctx.fns.compaction.portable({ model, producedBy: "claude-code:claude-opus-5", messages: [claudeCp] })!;
            expect(m.message_type).toBe("compaction_summary");
            expect(String(m.content)).toContain("Codename HERON-3");
        }
    });
    test("an opaque Codex checkpoint is unusable elsewhere → full transcript", async () => {
        const ctx: any = await mkTestCtx();
        expect(ctx.fns.compaction.portable({ model: "claude-code:claude-opus-5", producedBy: "codex:gpt-5", messages: [codexCp] })).toBeNull();
    });
    test("buildLlmRequest falls back to the full root transcript after switching away from Codex", async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: "codex:gpt-test", workspaceDir: process.cwd() });
        for (let i = 0; i < 12; i++) await ctx.fns.session.appendMessage({ id: agent.id, message: { role: i % 2 ? "assistant" : "user", content: `${i}:` + "x".repeat(16000) } });
        await ctx.fns.session.syncAgentState({ agent });
        ctx.state.registry.llm.compactCodex = () => ({ item: { type: "compaction", encrypted_content: "opaque" }, responseId: "r", usage: { prompt_tokens: 1, completion_tokens: 1 } });
        expect((await ctx.fns.agent.compactContext({ agent })).status).toBe("compacted");
        agent.model = "anthropic:claude-opus-5";
        const request = await ctx.fns.agent.buildLlmRequest({ agent });
        expect(request.messages.some((m: any) => m.message_type === "codex_compaction")).toBe(false);
        expect(request.messages.filter((m: any) => String(m.content).includes("x".repeat(100))).length).toBe(12);
    });
});
