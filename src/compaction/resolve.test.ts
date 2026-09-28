import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

describe("compaction.resolve", () => {
    test("loads $compaction_ files and falls back to default", async () => {
        const ctx: any = await mkTestCtx();
        expect(Object.keys(ctx.state.compaction.compactors)).toEqual(expect.arrayContaining(["default", "codex"]));
        expect(ctx.fns.compaction.resolve({ model: "codex/work:gpt-5" })).toMatchObject({ provider: "codex", fallback: false });
        expect(ctx.fns.compaction.resolve({ model: "claude-code:claude-opus-4" })).toMatchObject({ provider: "default", fallback: true });
    });

    test("default compactor drops oldest items on context overflow", async () => {
        const ctx: any = await mkTestCtx();
        const sizes: number[] = [];
        ctx.state.registry.llm.call = (_c: any, _s: any, o: any) => {
            const history = JSON.parse(o.user);
            sizes.push(history.length);
            if (history.length > 2) throw new Error("anthropic 400: prompt is too long: 213462 tokens > 200000 maximum");
            return { text: "short summary", finishReason: "stop", usage: {}, raw: {} };
        };
        const { compact } = ctx.fns.compaction.resolve({ model: "claude-code:claude-opus-4" });
        const messages = [
            { role: "user", content: "a" }, { role: "assistant", content: "", tool_calls: [{ id: "c1" }] },
            { role: "tool", content: "r", tool_call_id: "c1" }, { role: "user", content: "b" }, { role: "assistant", content: "c" },
        ];
        const result = await compact(ctx, null, { model: "claude-code:claude-opus-4", sessionId: "x", instructions: "", messages });
        expect(sizes).toEqual([5, 4, 2]);
        expect(result.summary).toBe("short summary");
        expect(result.message.message_type).toBe("compaction_summary");
        expect(result.message.content).toContain("short summary");
    });
});
