import { test, expect, describe } from "bun:test";
import listModels from "./listModels";

describe("llm.listModels", () => {
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

    // Subscription groups come only from llm.listAccounts. `accounts` stubs it; everything else is offline.
    const account = (provider: string, account: string, needsReconnect = false) => ({ provider, account, source: "file", available: !needsReconnect, needsReconnect });
    const offline = (accounts: any[], llm: Record<string, unknown> = {}) => ({ env: { LMSTUDIO_URL: "http://127.0.0.1:9" }, fns: { llm: {
        resolveEndpoint: async () => ({ kind: "api", apiKey: null }),
        listAccounts: async () => accounts,
        kimiCodingModels: async () => [],
        ...llm,
    } } }) as unknown as Context;

    test("connected Claude sources expose current Haiku, Sonnet, and Opus aliases, per account", async () => {
        const groups = await listModels(offline([account("claude-code", "default"), account("anthropic-oauth", "personal")]), null);
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
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/personal:claude-opus-5-5");
        expect(groups["anthropic-oauth"]!.some(model => model.startsWith("anthropic-oauth:"))).toBe(false);
    });

    test("keeps expired Claude accounts visible for reconnect", async () => {
        const groups = await listModels(offline([account("anthropic-oauth", "expired", true)]), null);
        expect(groups["anthropic-oauth"]).toContain("anthropic-oauth/expired:claude-opus-5-5");
    });

    test("connected xAI subscription exposes Grok Responses models", async () => {
        const groups = await listModels(offline([account("xai", "default")]), null);
        expect(groups.xai).toEqual(["xai:grok-4.6", "xai:grok-4.5", "xai:grok-4.3"]);
    });

    test("a named login without a default one shows like any other: Claude Code and Kimi", async () => {
        const groups = await listModels(offline([account("claude-code", "work"), account("kimi-coding", "team")], {
            kimiCodingModels: async ({ account }: { account: string }) => account === "team" ? ["kimi-coding/team:kimi-for-coding"] : [],
        }), null);
        expect(groups["claude-code"]).toContain("claude-code/work:claude-opus-5-5");
        expect(groups["claude-code"]!.some(m => m.startsWith("claude-code:"))).toBe(false);
        expect(groups["kimi-coding"]).toEqual(["kimi-coding/team:kimi-for-coding"]);
    });

    test("Codex catalogue comes from every connected account: a named login without a default still shows", async () => {
        const realFetch = globalThis.fetch;
        const seen: string[] = [];
        globalThis.fetch = (async (input: any, init?: any) => {
            const url = String(input?.url ?? input);
            if (!url.startsWith("https://chatgpt.com/backend-api/codex/models")) return realFetch(input, init);
            const auth = String(new Headers(init?.headers).get("authorization"));
            seen.push(auth);
            if (auth !== "Bearer adam-token") return new Response("no", { status: 401 });
            return Response.json({ models: [{ slug: "gpt-5.6-sol" }, { slug: "secret", visibility: "hidden" }, { slug: "gpt-5.5" }] });
        }) as typeof fetch;
        try {
            const tokens: Record<string, string | null> = { adam: "adam-token", gone: "gone-token" };
            const groups = await listModels(offline([account("codex", "adam"), account("codex", "gone", true)], {
                codexCliVersion: async () => "0.0.0",
                refreshCodex: async (opts?: { account?: string }) => tokens[opts?.account ?? "default"] ?? null,
            }), null);
            expect(groups.codex).toEqual(["codex/adam:gpt-5.6-sol", "codex/adam:gpt-5.5"]);
            expect(seen).toEqual(["Bearer adam-token"]);   // the account needing a reconnect is not asked
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    // The contract that keeps this class of bug out: every provider llm.listAccounts can report gets a catalogue
    // for a NAMED account (no default login present), and each route resolves back to that provider and account.
    test("contract: every provider listAccounts reports has a per-account catalogue that resolveEndpoint routes", async () => {
        const source = await Bun.file(new URL("./listAccounts.ts", import.meta.url)).text();
        // Providers listAccounts can report: literal entry("<provider>", …) calls plus its file-backed table
        // [["codex", ".codex/auth.json"], …]. A new provider added there shows up here by itself.
        const literal = [...source.matchAll(/entry\("([a-z][\w-]*)"/g)].map(m => m[1]!);
        const fileBacked = [...source.matchAll(/\["([a-z][\w-]*)", "\.[^"]+"\]/g)].map(m => m[1]!);
        const providers = [...new Set([...literal, ...fileBacked])].filter(p => p !== "hyper");
        expect(providers.length).toBeGreaterThanOrEqual(5);
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (input: any, init?: any) => String(input?.url ?? input).includes("/codex/models")
            ? Response.json({ models: [{ slug: "gpt-x" }] }) : realFetch(input, init)) as typeof fetch;
        try {
            const groups = await listModels(offline(providers.map(p => account(p, "named")), {
                codexCliVersion: async () => "0.0.0",
                refreshCodex: async (opts?: { account?: string }) => opts?.account === "named" ? "tok" : null,
                kimiCodingModels: async ({ account }: { account: string }) => [`kimi-coding${account === "default" ? "" : "/" + account}:k`],
            }), null);
            const resolveEndpoint = (await import("./resolveEndpoint")).default;
            const rctx = { env: {}, fns: { llm: { refreshKimiCode: async () => null, accountCredentialPath: () => ({ file: null }) }, settings: { getString: async () => "" } } } as unknown as Context;
            for (const provider of providers) {
                const ids = groups[provider] ?? [];
                expect({ provider, routes: ids.length > 0 }).toEqual({ provider, routes: true });
                for (const id of ids) {
                    expect(id.startsWith(`${provider}/named:`)).toBe(true);
                    const ep = await resolveEndpoint(rctx, null, { model: id }).catch(() => null);
                    expect({ id, provider: ep?.provider, account: ep?.account }).toEqual({ id, provider, account: "named" });
                }
            }
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});
