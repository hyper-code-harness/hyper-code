import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// $compaction_default must fit an oversized transcript (MB-sized tool dumps)
// into the summarizer's window before the first LLM call, instead of paying
// one failed call per dropped message.
describe("compaction default: oversized transcripts", () => {
    test("clips huge items and pre-trims oldest to the window budget in one call", async () => {
        const ctx: any = await mkTestCtx();
        const sent: string[] = [];
        ctx.state.registry.llm.call = async (_c: any, _s: any, o: any) => { sent.push(String(o.user)); return { text: "SUMMARY" }; };
        const compactor = ctx.fns.compaction.resolve({ model: "lmstudio:qwen3" });
        const messages: any[] = [];
        for (let i = 0; i < 80; i++) {
            messages.push({ role: "assistant", content: "", tool_calls: [{ id: `t${i}`, type: "function", function: { name: "bash", arguments: "{}" } }] });
            messages.push({ role: "tool", tool_call_id: `t${i}`, content: `dump${i}:` + "x".repeat(300_000) });
        }
        messages.push({ role: "user", content: "LATEST QUESTION" });
        const result = await compactor.compact(ctx, null, { model: "lmstudio:qwen3", sessionId: "s", instructions: "", messages });
        expect(result.summary).toBe("SUMMARY");
        expect(sent.length).toBe(1);
        const payload = sent[0]!;
        // qwen: 128k-token window * 3 chars * 0.8 budget
        expect(payload.length).toBeLessThanOrEqual(307_200);
        expect(payload).toContain("LATEST QUESTION");
        expect(payload).toContain("[clipped");
        const history = JSON.parse(payload);
        expect(history[0].role).not.toBe("tool");
    });

    test("leaves a small transcript untouched", async () => {
        const ctx: any = await mkTestCtx();
        let user = "";
        ctx.state.registry.llm.call = async (_c: any, _s: any, o: any) => { user = String(o.user); return { text: "S" }; };
        const compactor = ctx.fns.compaction.resolve({ model: "lmstudio:qwen" });
        const messages = [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }];
        await compactor.compact(ctx, null, { model: "lmstudio:qwen", sessionId: "s", instructions: "", messages });
        expect(JSON.parse(user)).toEqual(messages);
    });
});
