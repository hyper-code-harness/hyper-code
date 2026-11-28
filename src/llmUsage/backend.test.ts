import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import schema from "./schema.entry";

async function fixture(enabled = true) {
    const ctx = await mkTestCtx();
    await schema.up(ctx);
    await ctx.fns.procs.db.run({ sql: "DELETE FROM llm_usage_attempts" });
    await ctx.fns.procs.db.run({ sql: "DELETE FROM llm_usage_calls" });
    const get = ctx.state.registry.settings.get;
    ctx.state.registry.settings.get = (c: any, s: any, o: any) => o.module === "llmUsage" ? Promise.resolve(enabled) : get(c, s, o);
    return ctx;
}
const adapter = { provider: "openai", account: "primary", model: "gpt-test", api: "openai" as const };
const usage = { prompt_tokens: 100, completion_tokens: 15, prompt_tokens_details: { cached_tokens: 40 } };
const reply = () => new Response(JSON.stringify({ usage, choices: [{ message: { content: "secret-sentinel-prompt" } }] }), { headers: { "content-type": "application/json" } });
async function rows(ctx: any) {
    return { calls: await ctx.fns.procs.db.select({ sql: "SELECT * FROM llm_usage_calls ORDER BY started_at,id" }), attempts: await ctx.fns.procs.db.select({ sql: "SELECT * FROM llm_usage_attempts ORDER BY started_at,id" }) };
}
async function request(ctx: any, send: () => Promise<Response> = async () => reply()) {
    return await ctx.fns.llmUsage.fetch({ ...adapter, send });
}
function fragmented(text: string, step = 1) {
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset += step));
    } }), { headers: { "content-type": "text/event-stream" } });
}

describe("isolated LLM usage backend", () => {
    test("disabled, outside run and mock routes are true pass-throughs", async () => {
        const ctx = await fixture(false);
        let sends = 0;
        const raw = reply();
        const res = await ctx.fns.llmUsage.run({ operation: "call", fn: () => request(ctx, async () => { sends++; return raw; }) });
        expect(res).toBe(raw);
        expect(await request(ctx, async () => { sends++; return raw; })).toBe(raw);
        expect(sends).toBe(2);
        expect((await rows(ctx)).calls).toHaveLength(0);
    });

    test("nested retries create one durable call and two attempts, all actual tokens retained", async () => {
        const ctx = await fixture();
        await ctx.fns.llmUsage.run({ operation: "relay", source: "node", clientId: "trusted-client", clientName: "Trusted", requestedModel: "openai:gpt-test", fn: async () => {
            const first = await request(ctx, async () => new Response(JSON.stringify({ error: { message: "secret-sentinel-error" }, usage }), { status: 429, headers: { "content-type": "application/json" } }));
            await first.text();
            return await ctx.fns.llmUsage.run({ operation: "call", fn: async () => { const second = await request(ctx); await second.text(); return second; } });
        } });
        const result = await rows(ctx);
        expect(result.calls).toHaveLength(1);
        expect(result.calls[0].status).toBe("success");
        expect(result.calls[0].id).toMatch(/^[a-f0-9-]{36}$/);
        expect(result.attempts).toHaveLength(2);
        expect(result.attempts.map((a: any) => a.status)).toEqual(["error", "success"]);
        expect(result.attempts.map((a: any) => Number(a.input_tokens))).toEqual([60, 60]);
        expect(result.attempts.every((a: any) => a.cache_write_tokens === null)).toBe(true);
        expect(JSON.stringify(result)).not.toContain("secret-sentinel");
    });

    test("relay remains pending until byte consumption and preserves exact UTF8 CRLF multiline SSE", async () => {
        const ctx = await fixture();
        const text = 'data: {"choices":[{"delta":{"content":"Привет 🌍"}}]}\r\n\r\nevent: chunk\r\ndata: {"usage":\r\ndata: {"prompt_tokens":100,"completion_tokens":15,"prompt_tokens_details":{"cached_tokens":40}}}\r\n\r\ndata: [DONE]\r\n\r\n';
        const response = await ctx.fns.llmUsage.run({ operation: "relay", fn: () => request(ctx, async () => fragmented(text)) });
        expect((await rows(ctx)).calls[0].status).toBe("pending");
        expect(await response.text()).toBe(text);
        const result = await rows(ctx);
        expect(result.calls[0].status).toBe("success");
        expect(Number(result.attempts[0].input_tokens)).toBe(60);
        expect(Number(result.attempts[0].cache_read_tokens)).toBe(40);
    });

    test("Anthropic cumulative output and duplicate terminal frames never sum twice", async () => {
        const ctx = await fixture();
        const text = [
            { type: "message_start", message: { usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } } },
            { type: "message_delta", usage: { output_tokens: 8 } },
            { type: "message_delta", usage: { output_tokens: 12 } },
            { type: "message_delta", usage: { output_tokens: 12 } },
            { type: "message_stop" }, { type: "message_stop" },
        ].map(x => `data: ${JSON.stringify(x)}\n\n`).join("");
        await ctx.fns.llmUsage.run({ operation: "stream", fn: async () => {
            const res = await ctx.fns.llmUsage.fetch({ provider: "anthropic", account: "primary", model: "claude-test", api: "anthropic", send: async () => fragmented(text, 3) });
            await res.text();
        } });
        const a = (await rows(ctx)).attempts[0];
        expect([a.input_tokens, a.output_tokens, a.cache_read_tokens, a.cache_write_tokens].map(Number)).toEqual([10, 12, 5, 0]);
        expect(a.usage_state).toBe("known");
    });

    test("OpenAI cache refinement replaces cumulative input instead of taking max", async () => {
        const ctx = await fixture();
        const text = [0, 80].map(c => `data: ${JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: c } } })}\n\n`).join("") + "data: [DONE]";
        await ctx.fns.llmUsage.run({ operation: "stream", fn: async () => { await (await request(ctx, async () => fragmented(text, 7))).text(); } });
        const a = (await rows(ctx)).attempts[0];
        expect(Number(a.input_tokens)).toBe(20);
        expect(Number(a.cache_read_tokens)).toBe(80);
        expect(a.status).toBe("success");
    });

    test("HTTP200 SSE errors, truncated streams and cancellation are not successes", async () => {
        const ctx = await fixture();
        for (const text of ['event: error\ndata: {"type":"error","error":{"message":"secret"}}\n\n', 'data: {"choices":[]}\n\n']) {
            await ctx.fns.llmUsage.run({ operation: "relay", fn: async () => { const res = await request(ctx, async () => fragmented(text)); await res.text(); return res; } });
        }
        let cancelled = false;
        const response = await ctx.fns.llmUsage.run({ operation: "relay", fn: () => request(ctx, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } })) });
        await response.body.cancel("secret-cancel-reason");
        expect(cancelled).toBe(true);
        const result = await rows(ctx);
        expect(result.calls.map((c: any) => c.status)).toEqual(["error", "error", "cancelled"]);
        expect(result.attempts.map((a: any) => a.status)).toEqual(["error", "error", "cancelled"]);
    });

    test("large valid JSON stays success with unknown usage and byte-identical body", async () => {
        const ctx = await fixture();
        const text = JSON.stringify({ choices: [{ content: "x".repeat(300000) }], usage });
        await ctx.fns.llmUsage.run({ operation: "call", fn: async () => { expect(await (await request(ctx, async () => new Response(text, { headers: { "content-type": "application/json" } }))).text()).toBe(text); } });
        const a = (await rows(ctx)).attempts[0];
        expect(a.status).toBe("success");
        expect(a.usage_state).toBe("unknown");
    });

    test("remote SDK counts are unknown and cancelled SDK result closes local call", async () => {
        const ctx = await fixture();
        await ctx.fns.llmUsage.recordResult({ provider: "sdk", account: "a", model: "m", api: "sdk", usage: { inputTokens: 999 } });
        expect((await rows(ctx)).calls).toHaveLength(0);
        await ctx.fns.llmUsage.run({ operation: "stream", fn: async () => { await ctx.fns.llmUsage.recordResult({ provider: "cursor", account: "primary", model: "m", api: "sdk", usage: { inputTokens: 0, outputTokens: 2 }, status: "cancelled" }); } });
        await ctx.fns.llmUsage.run({ operation: "call", requestedModel: "hyper/remote:m", fn: async () => { await ctx.fns.llmUsage.recordResult({ provider: "hyper", account: "remote", model: "m", api: "sdk", usage: { inputTokens: 99 } }); } });
        const result = await rows(ctx);
        expect(result.calls[0].status).toBe("cancelled");
        expect(Number(result.attempts[0].input_tokens)).toBe(0);
        expect(result.calls[1].remote).toBe(true);
        expect(result.attempts[1].remote).toBe(true);
        expect(result.attempts[1].input_tokens).toBeNull();
    });

    test("accounting exceptions never replay callbacks or replace provider error identity", async () => {
        const ctx = await fixture();
        const original = ctx.state.registry.llmUsage.getState;
        ctx.state.registry.llmUsage.getState = () => { throw new Error("accounting-only"); };
        let count = 0;
        expect(await ctx.fns.llmUsage.run({ operation: "call", fn: async () => { count++; return "ok"; } })).toBe("ok");
        const failure = new Error("provider-original");
        await expect(ctx.fns.llmUsage.run({ operation: "call", fn: async () => { count++; throw failure; } })).rejects.toBe(failure);
        expect(count).toBe(2);
        ctx.state.registry.llmUsage.getState = original;
        ctx.state.registry.llmUsage.settle = () => { throw new Error("accounting-only"); };
        await ctx.fns.llmUsage.run({ operation: "stream", fn: async () => { const res = await request(ctx); expect(await res.text()).toContain("secret-sentinel"); } });
    });

    test("throwing after an unconsumed response closes pending metadata without replay or body reads", async () => {
        const ctx = await fixture();
        let sends = 0, pulls = 0, cancels = 0;
        const failure = new Error("consumer-original");
        await expect(ctx.fns.llmUsage.run({ operation: "call", fn: async () => {
            await request(ctx, async () => {
                sends++;
                return new Response(new ReadableStream({ pull() { pulls++; }, cancel() { cancels++; } }, { highWaterMark: 0 }), { headers: { "content-type": "text/event-stream" } });
            });
            throw failure;
        } })).rejects.toBe(failure);
        const result = await rows(ctx);
        expect([sends, pulls, cancels]).toEqual([1, 0, 0]);
        expect(result.calls[0].status).toBe("error");
        expect(result.attempts[0].status).toBe("error");
        expect(result.attempts[0].usage_state).toBe("unknown");
    });

    test("oversized SSE data still recognizes terminal event headers in either field order", async () => {
        const ctx = await fixture();
        const data = `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: "x".repeat(70000) } })}`;
        for (const text of [`event: response.completed\n${data}\n\n`, `${data}\nevent: response.completed\n\n`]) {
            await ctx.fns.llmUsage.run({ operation: "relay", fn: async () => {
                const res = await ctx.fns.llmUsage.fetch({ ...adapter, api: "responses", send: async () => fragmented(text, 8192) });
                expect(await res.text()).toBe(text); return res;
            } });
        }
        const result = await rows(ctx);
        expect(result.attempts.map((a: any) => [a.status, a.usage_state])).toEqual([["success", "unknown"], ["success", "unknown"]]);
    });

    test("concurrent first calls share the bounded settings read but retain distinct logical identities", async () => {
        const ctx = await fixture();
        const original = ctx.state.registry.settings.get;
        ctx.state.registry.settings.get = async (c: any, s: any, o: any) => { if (o.module === "llmUsage") { await new Promise(resolve => setTimeout(resolve, 20)); return true; } return original(c, s, o); };
        await Promise.all(Array.from({ length: 10 }, (_, i) => ctx.fns.llmUsage.run({ operation: "call", agentId: `a${i}`, fn: async () => { await (await request(ctx)).text(); } })));
        const result = await rows(ctx);
        expect(result.calls).toHaveLength(10);
        expect(result.attempts).toHaveLength(10);
        expect(new Set(result.calls.map((c: any) => c.agent_id)).size).toBe(10);
    });

    test("database outage is bounded fail-open and never sends twice", async () => {
        const ctx = await fixture();
        const original = ctx.state.registry.procs.db.run;
        ctx.state.registry.procs.db.run = () => new Promise(() => {});
        const started = Date.now();
        let count = 0;
        await ctx.fns.llmUsage.run({ operation: "call", fn: async () => { const res = await request(ctx, async () => { count++; return reply(); }); await res.text(); } });
        expect(count).toBe(1);
        expect(Date.now() - started).toBeLessThan(1000);
        ctx.state.registry.procs.db.run = original;
    });
});
