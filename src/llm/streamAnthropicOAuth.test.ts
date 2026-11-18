import { afterEach, describe, expect, test } from "bun:test";
import stream from "./streamAnthropic";
import fetchClaudeCode from "./fetchClaudeCode";
import parseSSE from "./parseSSE";
import toAnthropicMessages from "./toAnthropicMessages";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function emptySse() {
    return new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200 });
}

function mkCtx(provider: "anthropic-oauth" | "anthropic") {
    const ctx: any = { state: {}, env: {} };
    ctx.fns = {
        agent: {
            cacheRoot: async (o: any) => o.agent.id,
            buildLlmRequest: async () => ({
                system: provider === "anthropic-oauth" ? "You are Claude Code, Anthropic's official CLI for Claude." : "",
                messages: [{ role: "user", content: "hi" }],
            }),
            wireTools: () => [{ name: "functions.read", description: "read", input_schema: { type: "object", properties: {} } }],
        },
        llm: {
            resolveEndpoint: () => ({ url: "http://mock/v1/messages", modelId: "claude-x", apiKey: provider === "anthropic" ? "api-key" : null, provider, api: "anthropic" }),
            getAnthropicOAuthToken: async () => "managed-access",
            claudeCodeCliVersion: async () => "2.1.260",
            resolveReasoningEffort: async () => ({ requested: "off", applied: "off", mode: "none", downgraded: false, reason: null }),

            parseSSE: (opts: any) => parseSSE(ctx, null, opts),
            connectFetch: (o: any) => fetch(o.url, o.init),
            fetchClaudeCode: (o: any) => fetchClaudeCode(ctx, null, o),
            toAnthropicMessages: (opts: any) => toAnthropicMessages(ctx, null, opts),
        },
    };
    return ctx;
}

const agent = (provider: string) => ({ id: "a1", model: `${provider}:claude-x`, messages: [], scratchpad: {} } as any);

describe("Anthropic managed OAuth wire integration", () => {
    test("uses Bearer + Claude identity headers and preserves canonical tools", async () => {
        let init: any;
        globalThis.fetch = (async (_url: any, i: any) => { init = i; return emptySse(); }) as any;
        await stream(mkCtx("anthropic-oauth"), null, { agent: agent("anthropic-oauth") });
        expect(init.headers.authorization).toBe("Bearer managed-access");
        expect(init.headers["x-api-key"]).toBeUndefined();
        expect(init.headers["anthropic-beta"]).toContain("claude-code-20250219");
        expect(init.headers["anthropic-beta"]).toContain("oauth-2025-04-20");
        expect(init.headers["user-agent"]).toContain("claude-cli/");
        expect(init.headers["x-app"]).toBe("cli");
        const body = JSON.parse(init.body);
        expect(body.system).toBe("You are Claude Code, Anthropic's official CLI for Claude.");
        expect(body.tools[0].name).toBe("functions.read");
    });

    test("keeps API-key Anthropic behavior unchanged", async () => {
        let init: any;
        globalThis.fetch = (async (_url: any, i: any) => { init = i; return emptySse(); }) as any;
        await stream(mkCtx("anthropic"), null, { agent: agent("anthropic") });
        expect(init.headers["x-api-key"]).toBe("api-key");
        expect(init.headers.authorization).toBeUndefined();
        expect(init.headers["x-app"]).toBeUndefined();
        expect(init.headers["anthropic-beta"]).toBeUndefined();
    });
});
