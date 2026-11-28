import { afterEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import schema from "../llmUsage/schema.entry";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function withLedger(fn: (ctx: any) => Promise<void>) {
    const ctx = await mkTestCtx(); // Dedicated test database; never the working DB.
    await schema.up(ctx);
    const settingsGet = ctx.state.registry.settings.get;
    ctx.state.registry.settings.get = (c: any, s: any, o: any) => o.module === "llmUsage" && o.key === "enabled" ? Promise.resolve(true) : settingsGet(c, s, o);
    ctx.state.registry.llm.resolveEndpoint = async (_c: any, _s: any, o: any) => {
        const [route, modelId] = o.model.split(":");
        const [provider, account = "default"] = route.split("/");
        return { provider, account, modelId, api: provider === "anthropic" ? "anthropic" : "openai", kind: "api", url: "https://offline.invalid/inference", apiKey: "offline-secret" };
    };
    ctx.state.registry.llm.connectFetch = (_c: any, _s: any, o: any) => fetch(o.url, o.init);
    try { await fn(ctx); }
    finally { await schema.down(ctx); }
}
const rows = (ctx: any, table: string) => ctx.fns.procs.db.select({ sql: `SELECT * FROM ${table} ORDER BY started_at,id`, params: [] });

describe("local adapters with real accounting ledger", () => {
    test("stream observes raw usage, records owner and does not double count cached input", async () => withLedger(async ctx => {
        const agent = { id: "ledger-owner", model: "openai/work:test", messages: [], scratchpad: {} };
        ctx.state.registry.agent.buildLlmRequest = async () => ({ system: "private", messages: [{ role: "user", content: "do-not-store" }] });
        ctx.state.registry.agent.wireTools = () => [];
        ctx.state.registry.agent.cacheRoot = async () => agent.id;
        ctx.state.registry.llm.resolveReasoningEffort = async () => ({ requested: "auto", applied: "off", mode: "none" });
        globalThis.fetch = (async () => new Response('data: {"choices":[{"delta":{"content":"private reply"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":6}}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
        await ctx.fns.llm.stream({ agent });
        const calls = await rows(ctx, "llm_usage_calls"), attempts = await rows(ctx, "llm_usage_attempts");
        expect(calls).toHaveLength(1); expect(attempts).toHaveLength(1);
        expect(calls[0]).toMatchObject({ operation: "stream", agent_id: agent.id, status: "success" });
        expect(attempts[0]).toMatchObject({ provider: "openai", account: "work", status: "success" });
        expect(Number(attempts[0].input_tokens)).toBe(4);
        expect(Number(attempts[0].cache_read_tokens)).toBe(6);
        expect(Number(attempts[0].output_tokens)).toBe(4);
        expect(attempts[0].cache_write_tokens).toBeNull();
        expect(JSON.stringify([calls, attempts])).not.toMatch(/do-not-store|private reply|offline-secret/);
    }));

    test("Codex pre-send cancellation is a cancelled logical call with no transport attempt", async () => withLedger(async ctx => {
        const agent = { id: "ledger-owner", model: "codex/work:test", messages: [], scratchpad: {} };
        ctx.state.registry.llm.resolveEndpoint = async () => ({ provider: "codex", account: "work", modelId: "test", api: "responses", apiKey: null, kind: "subscription", url: "https://offline.invalid/inference" });
        ctx.state.registry.llm.refreshCodex = async () => `h.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } })).toString("base64url")}.s`;
        ctx.state.registry.llm.codexCliVersion = async () => "test";
        ctx.state.registry.llm.resolveReasoningEffort = async () => ({ requested: "auto", applied: "low", mode: "none" });
        ctx.state.registry.agent.buildLlmRequest = async () => ({ system: "", messages: [] });
        ctx.state.registry.agent.wireTools = () => [];
        ctx.state.registry.agent.cacheRoot = async () => agent.id;
        let sends = 0;
        globalThis.fetch = (async () => { sends++; throw new Error("unexpected network"); }) as unknown as typeof fetch;
        const ac = new AbortController(); ac.abort();
        await expect(ctx.fns.llm.stream({ agent, signal: ac.signal })).rejects.toMatchObject({ name: "AbortError", message: "aborted" });
        expect(sends).toBe(0);
        const calls = await rows(ctx, "llm_usage_calls");
        expect(calls).toHaveLength(1);
        expect(calls[0].status).toBe("cancelled");
        expect(await rows(ctx, "llm_usage_attempts")).toHaveLength(0);
    }));

    for (const exit of ["callback", "timeout"] as const) {
        test(`real SSE ${exit} failure releases transport and finalizes accounting`, async () => withLedger(async ctx => {
            const agent = { id: "ledger-owner", model: "openai/work:test", messages: [], scratchpad: {} };
            ctx.state.registry.agent.buildLlmRequest = async () => ({ system: "", messages: [] });
            ctx.state.registry.agent.wireTools = () => [];
            ctx.state.registry.agent.cacheRoot = async () => agent.id;
            ctx.state.registry.llm.resolveReasoningEffort = async () => ({ requested: "auto", applied: "off", mode: "none" });
            const parse = ctx.state.registry.llm.parseSSE;
            ctx.state.registry.llm.parseSSE = (c: any, s: any, o: any) => parse(c, s, { ...o, idleTimeoutMs: 5 });
            let cancelled = 0;
            globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
                start(c) { if (exit === "callback") c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"private"}}],"usage":{"prompt_tokens":3,"completion_tokens":1,"prompt_tokens_details":{"cached_tokens":0}}}\n\n')); },
                cancel() { cancelled++; },
            }), { headers: { "content-type": "text/event-stream" } })) as unknown as typeof fetch;
            const promise = ctx.fns.llm.stream({ agent, onEvent: () => { throw new Error("consumer failure"); } });
            await expect(promise).rejects.toThrow(exit === "callback" ? "consumer failure" : "stream stalled");
            const calls = await rows(ctx, "llm_usage_calls"), attempts = await rows(ctx, "llm_usage_attempts");
            expect(cancelled).toBe(1);
            expect(calls).toHaveLength(1); expect(attempts).toHaveLength(1);
            expect(calls[0].status).not.toBe("pending");
            expect(attempts[0].status).not.toBe("pending");
            expect(calls[0].finished_at).not.toBeNull();
            if (exit === "callback") expect(Number(attempts[0].input_tokens)).toBe(3);
            else expect(attempts[0].input_tokens).toBeNull();
        }));
    }

    test("native compaction validation failure and generic fallback share one call with two attempts", async () => withLedger(async ctx => {
        const agent = await ctx.fns.agent.start({ model: "anthropic:test", title: "ledger compaction" });
        for (let i = 0; i < 12; i++) await ctx.fns.session.appendMessage({ id: agent.id, message: { role: i % 2 ? "assistant" : "user", content: `${i}:` + "x".repeat(16000) } });
        await ctx.fns.session.syncAgentState({ agent });
        let sends = 0;
        globalThis.fetch = (async (_url: any, init: any) => {
            sends++;
            const body = JSON.parse(init.body);
            return Response.json(body.compaction
                ? { content: [], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
                : { content: [{ type: "text", text: "handoff summary" }], stop_reason: "end_turn", usage: { input_tokens: 9, output_tokens: 3, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } });
        }) as unknown as typeof fetch;
        const result = await ctx.fns.agent.compactContext({ agent });
        expect(result.status).toBe("compacted"); expect(sends).toBe(2);
        const calls = await rows(ctx, "llm_usage_calls"), attempts = await rows(ctx, "llm_usage_attempts");
        expect(calls).toHaveLength(1); expect(attempts).toHaveLength(2);
        expect(calls[0]).toMatchObject({ operation: "compact", agent_id: agent.sleepContext.generations.at(-1).contextAgentId, status: "success" });
        expect(new Set(attempts.map((a: any) => a.call_id)).size).toBe(1);
        expect(attempts.reduce((n: number, a: any) => n + Number(a.input_tokens), 0)).toBe(21);
    }));
});
