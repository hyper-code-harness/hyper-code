import { afterEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// The real injecting registry proves session ownership and integration boundaries.
// Transport and ledger spies keep these tests offline and independent of storage.
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const fakeJwt = `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url")}.s`;

async function fixture() {
    const ctx = await mkTestCtx();
    const calls: Array<{ operation: string; requestedModel?: string; agentId?: string }> = [];
    const attempts: Array<{ provider: string; account: string; model: string; api: string }> = [];
    const reg = ctx.state.registry;
    reg.llmUsage ??= {};
    reg.llmUsage.run = async (_ctx: any, session: any, opts: any) => {
        calls.push({ operation: opts.operation, requestedModel: opts.requestedModel, agentId: opts.agentId ?? session?.agentId });
        return await opts.fn();
    };
    reg.llmUsage.fetch = async (_ctx: any, _session: any, opts: any) => {
        expect(Object.keys(opts).sort()).toEqual(["account", "api", "model", "provider", "send"]);
        attempts.push({ provider: opts.provider, account: opts.account, model: opts.model, api: opts.api });
        return await opts.send();
    };
    reg.llm.resolveEndpoint = async (_ctx: any, _session: any, { model }: any) => {
        const [route, modelId] = model.split(":");
        const [provider, account = "default"] = route.split("/");
        const api = ["anthropic", "claude-code", "anthropic-oauth"].includes(provider) ? "anthropic" : ["codex", "xai"].includes(provider) ? "responses" : provider === "mock" ? "mock" : "openai";
        return { provider, account, modelId, api, url: "https://offline.invalid/inference", apiKey: "not-a-real-secret", kind: "api" };
    };
    reg.llm.connectFetch = (_ctx: any, _session: any, opts: any) => fetch(opts.url, opts.init);
    reg.llm.refreshCodex = async () => fakeJwt;
    reg.llm.getXaiOAuthToken = async () => "not-a-real-secret";
    reg.llm.refreshUsage = async () => [];
    reg.llm.recordUsage = async () => null;
    reg.llm.accountAuthHealth = async () => [];
    reg.llm.codexCliVersion = async () => "test";
    reg.llm.resolveReasoningEffort = async () => ({ requested: "auto", applied: "low", mode: "none", downgraded: false, reason: null });
    reg.agent.buildLlmRequest = async () => ({ system: "private instructions", messages: [{ role: "user", content: "private prompt" }] });
    reg.agent.wireTools = () => [];
    reg.agent.cacheRoot = async () => "owner";
    return { ctx, calls, attempts };
}

function owned(ctx: any, model: string) {
    const agent = { id: "accounting-owner", model, messages: [], scratchpad: {} };
    const actx = Object.create(ctx);
    actx.session = ctx.fns.session.forAgent({ agent });
    return { ctx: actx, agent };
}
function sse(events: string[]) { return new Response(events.join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } }); }

describe("local LLM accounting integration", () => {
    test("one logical call contains model fallback attempts and keeps the calling agent", async () => {
        const { ctx, calls, attempts } = await fixture();
        const owner = owned(ctx, "openai/first:primary");
        ctx.state.registry.settings.getString = () => "openai/second:fallback";
        let n = 0;
        globalThis.fetch = (async () => ++n === 1
            ? new Response("usage_limit_reached", { status: 429 })
            : Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } })) as unknown as typeof fetch;
        const result = await owner.ctx.fns.llm.call({ model: owner.agent.model, user: "private prompt" });
        expect(result.text).toBe("ok");
        expect(calls).toEqual([{ operation: "call", requestedModel: "openai/first:primary", agentId: owner.agent.id }]);
        expect(attempts).toEqual([
            { provider: "openai", account: "first", model: "primary", api: "openai" },
            { provider: "openai", account: "second", model: "fallback", api: "openai" },
        ]);
        expect(result.fallback.attempts).toEqual([{ model: owner.agent.model, count: 1 }, { model: "openai/second:fallback", count: 1 }]);
    });

    test("unsupported temperature retries are attempts, not extra logical calls", async () => {
        const { ctx, calls, attempts } = await fixture();
        let n = 0;
        globalThis.fetch = (async () => ++n === 1
            ? new Response("temperature is unsupported", { status: 400 })
            : Response.json({ choices: [{ message: { content: "ok" } }] })) as unknown as typeof fetch;
        await ctx.fns.llm.call({ model: "openai:test", user: "private prompt", temperature: 0.1, noFallback: true });
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(2);
    });

    test("post-response structured validation failure does not erase the observed send", async () => {
        const { ctx, calls, attempts } = await fixture();
        globalThis.fetch = (async () => Response.json({ choices: [{ message: { content: "not JSON" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } })) as unknown as typeof fetch;
        await expect(ctx.fns.llm.call({ model: "openai:test", user: "private prompt", noFallback: true, response_format: { type: "json_object" } })).rejects.toThrow("invalid structured JSON");
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(1);
    });

    for (const provider of ["openai", "lmstudio", "codex", "xai"]) {
        test(`stream dispatcher owns one call and observes ${provider} transport`, async () => {
            const { ctx, calls, attempts } = await fixture();
            const owner = owned(ctx, `${provider}/work:test`);
            globalThis.fetch = (async () => provider === "openai" || provider === "lmstudio"
                ? sse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":2}}', 'data: [DONE]'])
                : sse(['data: {"type":"response.output_text.delta","delta":"ok"}', 'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":9,"output_tokens":2}}}'])) as unknown as typeof fetch;
            const result = await owner.ctx.fns.llm.stream({ agent: owner.agent });
            expect(result.text).toBe("ok");
            expect(calls).toEqual([{ operation: "stream", requestedModel: owner.agent.model, agentId: owner.agent.id }]);
            expect(attempts).toEqual([{ provider, account: "work", model: "test", api: ["codex", "xai"].includes(provider) ? "responses" : "openai" }]);
        });
    }

    test("native Codex compaction has its own logical operation and real send", async () => {
        const { ctx, calls, attempts } = await fixture();
        const owner = owned(ctx, "codex/work:test");
        globalThis.fetch = (async () => sse([
            'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"private checkpoint"}}',
            'data: {"type":"response.completed","response":{"id":"response-1","usage":{"input_tokens":8,"output_tokens":3}}}',
        ])) as unknown as typeof fetch;
        await owner.ctx.fns.llm.compactCodex({ model: owner.agent.model, sessionId: owner.agent.id, instructions: "private", messages: [] });
        expect(calls).toEqual([{ operation: "compact", requestedModel: owner.agent.model, agentId: owner.agent.id }]);
        expect(attempts).toEqual([{ provider: "codex", account: "work", model: "test", api: "responses" }]);
    });
});
