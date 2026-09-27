import { test, expect, describe } from "bun:test";
import start from "../agent/start";
import stream from "./streamOpenAI";
import resolveEndpoint from "./resolveEndpoint";
import parseSSE from "./parseSSE";
import fullSystemPrompt from "../agent/fullSystemPrompt";
import buildLlmRequest from "../agent/buildLlmRequest";

// Exercises streamOpenAI directly, bypassing the stream.ts dispatcher.
// Plain-object ctx (not the injecting Proxy) — fns entries are invoked with
// opts only, so real fns are wrapped as (opts) => raw(ctx, null, opts).
const mkCtx = () => {
    const ctx: any = {
        state: {},
        env: { LMSTUDIO_URL: process.env.LMSTUDIO_URL, MODEL: process.env.MODEL },
    };
    ctx.fns = {
        llm: {
            resolveEndpoint: (opts: any) => resolveEndpoint(ctx, null, opts),
            parseSSE: (opts: any) => parseSSE(ctx, null, opts),
            connectFetch: (o: any) => fetch(o.url, o.init),
        },
        agent: {
            fullSystemPrompt: (opts: any) => fullSystemPrompt(ctx, null, opts),
            cacheRoot: async (o: any) => o.agent.id,
            buildLlmRequest: (opts: any) => buildLlmRequest(ctx, null, opts),
        },
    };
    return ctx as unknown as Context;
};

// Live integration with LM Studio at process.env.LMSTUDIO_URL.
// Skipped by default — opt in with LIVE_LLM=1 bun test ./src/llm/streamOpenAI.test.ts.
// Per AGENTS.md, the regular test suite must use mock:* models via streamMock.
describe.skipIf(!process.env.LIVE_LLM)("agent.stream — stateless /v1/chat/completions (LM Studio)", () => {
    test("env loaded from .env.test", () => {
        expect(process.env.LMSTUDIO_URL).toBe("http://localhost:1234");
        expect(process.env.MODEL).toBeDefined();
    });

    test("plain text reply", async () => {
        const ctx = mkCtx();
        const agent = await start(ctx, null, {
            model: process.env.MODEL!,
            systemPrompt: "Reply in one short sentence.",
        });
        agent.messages.push({ role: "user", content: "say hi" });
        const result = await stream(ctx, null, { agent });
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.usage?.prompt_tokens ?? result.usage?.input_tokens).toBeGreaterThan(0);
    }, 60_000);

    test("emits text_delta via onEvent callback", async () => {
        const ctx = mkCtx();
        const agent = await start(ctx, null, {
            model: process.env.MODEL!,
            systemPrompt: "Reply in one short sentence.",
        });
        agent.messages.push({ role: "user", content: "pick a number 1-9" });
        const deltas: string[] = [];
        const result = await stream(ctx, null, {
            agent,
            onEvent: (ev) => { if (ev.type === "text_delta") deltas.push(ev.delta); },
        });
        expect(deltas.length).toBeGreaterThan(0);
        expect(deltas.join("")).toBe(result.text);
    }, 60_000);

});
