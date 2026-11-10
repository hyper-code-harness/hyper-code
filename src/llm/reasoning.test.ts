import { describe, expect, test } from "bun:test";
import capabilities from "./reasoningCapabilities";
import resolve from "./resolveReasoningEffort";

const ctx: any = { fns: { llm: { reasoningCapabilities: (o:any) => capabilities(ctx, null, o) } } };

describe("reasoning effort policy", () => {
    test("Codex supports effort and defaults to medium", async () => {
        const caps = await capabilities(ctx, null, { model: "codex/persona:gpt-5.6-sol" });
        expect(caps).toMatchObject({ defaultEffort: "medium", mode: "openai-effort" });
        expect(caps.supported).toContain("xhigh");
    });
    test("Opus 4.6 maps xhigh through adaptive thinking", async () => {
        const caps = await capabilities(ctx, null, { model: "anthropic-oauth/pro:claude-opus-4-6" });
        expect(caps).toMatchObject({ defaultEffort: "medium", mode: "anthropic-adaptive" });
        expect((await resolve(ctx, null, { model: "anthropic-oauth/pro:claude-opus-4-6", effort: "xhigh" })).applied).toBe("xhigh");
    });
    test("unsupported xhigh safely downgrades without changing preference", async () => {
        const value = await resolve(ctx, null, { model: "anthropic-oauth/pro:claude-sonnet-4-6", effort: "xhigh" });
        expect(value).toMatchObject({ requested: "xhigh", applied: "high", downgraded: true });
    });
    test("non-reasoning models resolve to off", async () => {
        expect(await resolve(ctx, null, { model: "lmstudio:plain", effort: "high" })).toMatchObject({ applied: "off", mode: "none" });
    });
    // Fable rejects thinking.type "disabled" (live API, Fable 5.1/5.2). It stays on mode "none": no thinking
    // field is sent and the model thinks adaptively by itself. streamAnthropic sends "disabled" for an
    // adaptive-mode "off" on any model it does not know as Claude 5, so Fable must not enter that mode.
    test("Fable never resolves to a mode that sends thinking disabled", async () => {
        for (const model of ["claude-code:claude-fable-5-1", "claude-code:claude-fable-5-2"]) {
            for (const effort of ["auto", "off", "high"] as const) {
                expect((await resolve(ctx, null, { model, effort })).mode).toBe("none");
            }
        }
    });
});
