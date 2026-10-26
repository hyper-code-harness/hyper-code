import { test, expect, describe } from "bun:test";
import listModels from "./listModels";

describe("llm.listModels", () => {
    // The bug: a Codex login made from Settings lives in a named slot, but the catalogue
    // only asked for the default one — so a logged-in person saw no OpenAI models at all.
    test("every logged-in Codex account contributes its models under its own route", async () => {
        const asked: string[] = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({ models: [{ slug: "gpt-x" }, { slug: "hidden", visibility: "hidden" }] }))) as any;
        try {
            const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
                kimiCodingModels: async () => [],
                resolveEndpoint: async () => ({ kind: "api", apiKey: null }),
                listAccounts: async () => [{ account: "personal", needsReconnect: false }, { account: "stale", needsReconnect: true }],
                codexCliVersion: async () => "1.0.0",
                refreshCodex: async ({ account }: any) => { asked.push(account); return "token"; },
            } } } as unknown as Context;
            const groups = await listModels(ctx, null, { skipNodes: true });
            expect(groups.codex).toEqual(["codex/personal:gpt-x"]);
            expect(asked).toEqual(["personal"]);
        } finally { globalThis.fetch = realFetch; }
    });

    test("named Claude Code and Kimi Coding logins show up too, not only the default slot", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            resolveEndpoint: async () => ({ kind: "api", apiKey: null }),
            listAccounts: async ({ provider }: any) => provider === "claude-code"
                ? [{ provider: "claude-code", account: "work", needsReconnect: false }]
                : provider === "kimi-coding" ? [{ provider: "kimi-coding", account: "home", needsReconnect: false }] : [],
            refreshClaudeCode: async ({ account }: any) => account === "work" ? "token" : null,
            kimiCodingModels: async ({ account }: any) => account === "home" ? ["kimi-coding/home:k2"] : [],
        } } } as unknown as Context;
        const groups = await listModels(ctx, null, { skipNodes: true });
        expect(groups["claude-code"]).toContain("claude-code/work:claude-sonnet-4-6");
        expect(groups["claude-code"]!.some(m => m.startsWith("claude-code:"))).toBe(false);
        expect(groups["kimi-coding"]).toEqual(["kimi-coding/home:k2"]);
    });
    test("omits static remote catalogues when their credentials are absent", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            kimiCodingModels: async () => [],
            resolveEndpoint: async ({ model }: any) => ({ kind: "api", apiKey: model.startsWith("openai:") ? "key" : null }),
        } } } as unknown as Context;
        const groups = await listModels(ctx, null);
        expect(groups.kimi).toBeUndefined();
        expect(groups["kimi-coding"]).toBeUndefined();
        expect(groups.openrouter).toBeUndefined();
        expect(groups.groq).toBeUndefined();
        expect(groups.openai).toBeDefined();
        expect(groups.openai!.every(m => m.startsWith("openai:"))).toBe(true);
    });

    test("connected Claude sources expose current Haiku, Sonnet, and Opus aliases", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            kimiCodingModels: async () => [],
            resolveEndpoint: async () => ({ kind: "api", apiKey: null }),
            refreshClaudeCode: async () => "token",
            listAccounts: async ({ provider }: any) => provider === "claude-code" ? [{ provider, account: "default", needsReconnect: false }] : [],
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
            kimiCodingModels: async () => [],
            resolveEndpoint: async () => ({ kind: "api", apiKey: null }),
            refreshClaudeCode: async () => null,
            anthropicOAuthStatus: async () => ({ connected: true, accounts: [{ account: "expired", needsReconnect: true }] }),
        } } } as unknown as Context;
        const groups = await listModels(ctx, null);
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/expired:claude-opus-5-5");
    });


    test("connected xAI subscription exposes Grok Responses models", async () => {
        const ctx = { env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
            kimiCodingModels: async () => [],
            resolveEndpoint: async () => ({ kind: "api", apiKey: null }),
            xaiOAuthStatus: async () => ({ connected: true }),
        } } } as unknown as Context;
        const groups = await listModels(ctx, null);
        expect(groups.xai).toEqual(["xai:grok-4.6", "xai:grok-4.5", "xai:grok-4.3"]);
    });


});
