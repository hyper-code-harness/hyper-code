import { test, expect, describe } from "bun:test";
import listModels from "./listModels";

describe("llm.listModels", () => {
    test("always returns remote provider groups even with no LM Studio", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {} } } as unknown as Context;  // unreachable
        const groups = await listModels(ctx, null);
        expect(groups.kimi).toBeDefined();
        expect(groups["kimi-coding"]).toEqual([
            "kimi-coding:k3",
            "kimi-coding:k3-256k",
            "kimi-coding:kimi-for-coding",
            "kimi-coding:kimi-for-coding-highspeed",
        ]);
        expect(groups.kimi).toContain("kimi:kimi-k3");
        expect(groups.openai).toBeDefined();
        expect(groups.kimi!.every(m => m.startsWith("kimi:"))).toBe(true);
        expect(groups.openai!.every(m => m.startsWith("openai:"))).toBe(true);
    });

    test("connected Claude sources expose current Haiku, Sonnet, and Opus aliases", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            refreshClaudeCode: async () => "token",
            anthropicOAuthStatus: async () => ({ connected: true, accounts: [{ account: "personal", needsReconnect: false }] }),
        } } } as unknown as Context;
        const groups = await listModels(ctx, null);
        expect(groups["claude-code"]).toEqual([
            "claude-code:claude-haiku-4-5",
            "claude-code:claude-sonnet-4-5",
            "claude-code:claude-sonnet-4-6",
            "claude-code:claude-sonnet-5",
            "claude-code:claude-opus-4-5",
            "claude-code:claude-opus-4-6",
            "claude-code:claude-opus-4-8",
            "claude-code:claude-opus-5",
            "claude-code:claude-opus-5-5",
            "claude-code:claude-fable-5",
            "claude-code:claude-fable-5-1",
        ]);
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-sonnet-4-6");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-opus-4-6");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-opus-4-8");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-sonnet-5");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-opus-5");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-opus-5-5");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-fable-5");
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-fable-5-1");
        expect(groups["anthropic-oauth"]!.some(model => model.startsWith("anthropic-oauth:"))).toBe(false);
    });
    test("keeps expired managed Claude accounts visible for reconnect", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            refreshClaudeCode: async () => null,
            anthropicOAuthStatus: async () => ({ connected: true, accounts: [{ account: "expired", needsReconnect: true }] }),
        } } } as unknown as Context;
        const groups = await listModels(ctx, null);
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/expired:claude-opus-5-5");
    });


    test("connected xAI subscription exposes Grok Responses models", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            xaiOAuthStatus: async () => ({ connected: true }),
        } } } as unknown as Context;
        const groups = await listModels(ctx, null);
        expect(groups.xai).toEqual(["xai:grok-4.6", "xai:grok-4.5", "xai:grok-4.3"]);
    });


});
