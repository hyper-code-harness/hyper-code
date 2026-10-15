import { test, expect, describe, afterEach } from "bun:test";
import stream from "./streamAnthropic";
import parseSSE from "./parseSSE";
import toAnthropicMessages from "./toAnthropicMessages";

// Offline: drive streamAnthropic through the shared parseSSE with a mocked fetch.
// Uses provider 'anthropic' so no OAuth refresh path is touched.
function sseResponse(...chunks: string[]): Response {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(c) { for (const s of chunks) c.enqueue(enc.encode(s)); c.close(); },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
// Plain-object ctx (not the injecting Proxy) — fns entries are invoked with
// opts only, so shared real fns are wrapped as (opts) => raw(ctx, null, opts).
function mkCtx(): Context {
    const ctx: any = { state: {}, env: {} };
    ctx.fns = {
        agent: {
            cacheRoot: async (o: any) => o.agent.id,
            buildLlmRequest: async () => ({ system: "sys", messages: [{ role: "user", content: "hi" }] }),
            wireTools: () => [],
        },
        llm: {
            resolveEndpoint: () => ({ url: "http://mock/v1/messages", modelId: "claude-x", apiKey: "k", provider: "anthropic", api: "anthropic" }),
            parseSSE: (opts: any) => parseSSE(ctx, null, opts),
            resolveReasoningEffort: async () => ({ requested: "high", applied: "high", mode: "anthropic-adaptive", downgraded: false, reason: null }),
            connectFetch: (o: any) => fetch(o.url, o.init),
            toAnthropicMessages: (opts: any) => toAnthropicMessages(ctx, null, opts),
        },
    };
    return ctx as unknown as Context;
}
const agent = () => ({ id: "a1", model: "anthropic:claude-x", systemPrompt: "", messages: [], scratchpad: {} } as any);

describe("streamAnthropic — offline (mocked fetch + shared parseSSE)", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });

    test("accumulates text deltas, maps stop_reason, reads usage", async () => {
        globalThis.fetch = (async () => sseResponse(
            'event: message_start\ndata: {"message":{"usage":{"input_tokens":10}}}\n\n',
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hel"}}\n\n',
            'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"lo"}}\n\n',
            'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
        )) as any;
        const deltas: string[] = [];
        const res = await stream(mkCtx(), null, { agent: agent(), onEvent: (ev) => { if (ev.type === "text_delta") deltas.push(ev.delta); } });
        expect(res.text).toBe("Hello");
        expect(res.finishReason).toBe("stop"); // end_turn → stop
        expect(res.usage.prompt_tokens).toBe(10);
        expect(res.usage.completion_tokens).toBe(5);
        expect(deltas.join("")).toBe("Hello");
    });

    test("sends adaptive thinking and Anthropic output effort", async () => {
        let request: any;
        globalThis.fetch = (async (_url:any, init:any) => { request = JSON.parse(init.body); return sseResponse(); }) as any;
        await stream(mkCtx(), null, { agent: { ...agent(), reasoningEffort: "high" } });
        expect(request.thinking).toEqual({ type: "adaptive" });
        expect(request.output_config).toEqual({ effort: "high" });
    });


    test("Claude 5 never gets thinking disabled or an effort the API rejects", async () => {
        const sent = async (modelId: string, applied: string) => {
            let request: any;
            globalThis.fetch = (async (_url: any, init: any) => { request = JSON.parse(init.body); return sseResponse(); }) as any;
            const ctx: any = mkCtx();
            ctx.fns.llm.resolveEndpoint = () => ({ url: "http://mock/v1/messages", modelId, apiKey: "k", provider: "anthropic", api: "anthropic" });
            ctx.fns.llm.resolveReasoningEffort = async () => ({ requested: "auto", applied, mode: "anthropic-adaptive", downgraded: false, reason: null });
            await stream(ctx, null, { agent: agent() });
            return request;
        };
        const auto5 = await sent("claude-opus-5-5", "off");
        expect(auto5.thinking).toBeUndefined();
        expect(auto5.output_config).toBeUndefined();
        expect((await sent("claude-opus-5-5", "xhigh")).output_config).toEqual({ effort: "max" });
        expect((await sent("claude-sonnet-4-6", "off")).thinking).toEqual({ type: "disabled" });
    });

    test("handles Kimi-style SSE (no space after colon) + thinking deltas", async () => {
        globalThis.fetch = (async () => sseResponse(
            'event:content_block_delta\ndata:{"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n',
            'event:content_block_delta\ndata:{"delta":{"type":"text_delta","text":"yo"}}\n\n',
        )) as any;
        const res = await stream(mkCtx(), null, { agent: agent() });
        expect(res.text).toBe("yo");
        expect(res.thinking).toBe("hmm");
    });
});

    test("marks cache breakpoints on the bootstrap turn and the conversation tail", async () => {
        let request: any;
        globalThis.fetch = (async (_url: any, init: any) => { request = JSON.parse(init.body); return sseResponse(); }) as any;
        const ctx: any = mkCtx();
        ctx.fns.agent.buildLlmRequest = async () => ({ system: "sys", messages: [
            { role: "user", content: "core prompt" },
            { role: "assistant", content: "Understood. Ready to act." },
            { role: "user", content: "hi" },
        ] });
        await stream(ctx, null, { agent: agent() });
        const m = request.messages;
        expect(m.length).toBe(3);
        expect(m[1].content[m[1].content.length - 1].cache_control).toEqual({ type: "ephemeral" });
        expect(m[2].content[0]).toEqual({ type: "text", text: "hi", cache_control: { type: "ephemeral" } });
        expect(m[0].content[0].cache_control).toBeUndefined();
    });

    test("reports cached prompt tokens in usage", async () => {
        globalThis.fetch = (async () => sseResponse(
            'event: message_start\ndata: {"message":{"usage":{"input_tokens":5,"cache_read_input_tokens":90,"cache_creation_input_tokens":5}}}\n\n',
        )) as any;
        const res = await stream(mkCtx(), null, { agent: agent() });
        expect(res.usage.prompt_tokens).toBe(100);
        expect(res.usage.cache_read_tokens).toBe(90);
        expect(res.usage.cache_write_tokens).toBe(5);
    });
