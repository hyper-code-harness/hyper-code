import { describe, expect, test } from "bun:test";
import capabilities from "./reasoningCapabilities";

describe("llm.reasoningCapabilities xAI", () => {
    test("Grok 4 subscription models expose Responses effort levels", async () => {
        const result = await capabilities({} as Context, null, { model: "xai/work:grok-4.6" });
        expect(result.mode).toBe("openai-effort");
        expect(result.defaultEffort).toBe("medium");
        expect(result.supported).toEqual(["auto", "off", "minimal", "low", "medium", "high", "xhigh"]);
    });
});

describe("llm.reasoningCapabilities gpt-6", () => {
    test("gpt-6 never offers off/minimal and off resolves up to low", async () => {
        const result = await capabilities({} as Context, null, { model: "codex:gpt-6-astra" });
        expect(result.supported).toEqual(["auto", "low", "medium", "high", "xhigh"]);
        const resolve = (await import("./resolveReasoningEffort")).default;
        const ctx = { fns: { llm: { reasoningCapabilities: (o: any) => capabilities({} as Context, null, o) } } } as any;
        const r = await resolve(ctx, null, { model: "codex:gpt-6-astra", effort: "off" });
        expect(r.applied).toBe("low");
        expect(r.downgraded).toBe(true);
    });
});
