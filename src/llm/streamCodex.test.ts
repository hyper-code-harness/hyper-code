import { test, expect, describe, afterEach } from "bun:test";
import stream from "./streamCodex";
import parseSSE from "./parseSSE";
import toCodexInput from "./toCodexInput";

// Offline: drive streamCodex through the shared parseSSE with a mocked fetch and
// a stubbed refreshCodex returning a fake JWT carrying a chatgpt_account_id
// (so extractAccountId succeeds without real OAuth).
function sseResponse(...chunks: string[]): Response {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
        start(c) { for (const s of chunks) c.enqueue(enc.encode(s)); c.close(); },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const fakeJwt = "h." +
    Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc1" } })).toString("base64url") +
    ".s";
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
            resolveEndpoint: () => ({ url: "http://mock/codex", modelId: "gpt-x", apiKey: "", provider: "codex", api: "responses" }),
            refreshCodex: async () => fakeJwt,
            resolveReasoningEffort: async () => ({ requested: "high", applied: "high", mode: "openai-effort", downgraded: false, reason: null }),
            toCodexInput: (opts: any) => toCodexInput(ctx, null, opts),
            accountAuthHealth: async () => [],
            parseSSE: (opts: any) => parseSSE(ctx, null, opts),
            connectFetch: (o: any) => fetch(o.url, o.init),
            codexCliVersion: async () => "0.0.0-test",
        },
    };
    return ctx as unknown as Context;
}
const agent = () => ({ id: "a1", model: "codex:gpt-x", systemPrompt: "", messages: [], scratchpad: {} } as any);

describe("streamCodex — offline (mocked fetch + shared parseSSE)", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = realFetch; });

    test("accumulates output_text deltas, reads usage + status, skips [DONE]", async () => {
        globalThis.fetch = (async () => sseResponse(
            'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
            'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
            'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":7,"output_tokens":4}}}\n\n',
            "data: [DONE]\n\n",
        )) as any;
        const deltas: string[] = [];
        const res = await stream(mkCtx(), null, { agent: agent(), onEvent: (ev) => { if (ev.type === "text_delta") deltas.push(ev.delta); } });
        expect(res.text).toBe("Hello");
        expect(res.finishReason).toBe("stop"); // mapStop("completed") → "stop"
        expect(res.usage.prompt_tokens).toBe(7);
        expect(res.usage.completion_tokens).toBe(4);
        expect(deltas.join("")).toBe("Hello");
    });

    test("sends the applied effort in the Responses reasoning object", async () => {
        let request: any;
        globalThis.fetch = (async (_url:any, init:any) => { request = JSON.parse(init.body); return sseResponse('data: [DONE]\\n\\n'); }) as any;
        await stream(mkCtx(), null, { agent: { ...agent(), reasoningEffort: "high" } });
        expect(request.reasoning).toEqual({ effort: "high", summary: "auto" });
    });


    test("captures reasoning_summary deltas as thinking", async () => {
        globalThis.fetch = (async () => sseResponse(
            'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}\n\n',
            'data: {"type":"response.output_text.delta","delta":"out"}\n\n',
        )) as any;
        const res = await stream(mkCtx(), null, { agent: agent() });
        expect(res.text).toBe("out");
        expect(res.thinking).toBe("think");
    });
});
