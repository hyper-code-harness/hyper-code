import { describe, expect, test } from "bun:test";
import call from "./call";
import streamAnthropic from "./streamAnthropic";
import compactAnthropic from "./compactAnthropic";
import relay from "../node/relay";
import fetchClaude from "./fetchClaude";
import parseSSE from "./parseSSE";
import toAnthropicMessages from "./toAnthropicMessages";

type Route = "call" | "stream" | "compact" | "relay";
const routes: Route[] = ["call", "stream", "compact", "relay"];
const block = { type: "compaction", content: "summary", signature: "fixture-signature" };

// Real entry points + real 401 helper; only credentials, HTTP, and unrelated
// metadata are mocked. No global fetch patch, live registry, DB, or Keychain.
function fixture(route: Route, provider = "claude-code", retryStatus = 200) {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    const refreshes: Array<{ account?: string; rejectedToken?: string }> = [];
    let cancelled = false;
    const endpoint = { provider, account: "work", modelId: "claude-test", url: "https://fixture.invalid/v1/messages", api: "anthropic", apiKey: null, kind: "subscription" };
    const ctx: any = { env: {}, state: {}, fns: { llm: {}, node: {}, agent: {}, procs: { log: { info: () => {} } } } };
    Object.assign(ctx.fns.llm, {
        resolveEndpoint: async () => endpoint,
        resolveReasoningEffort: async () => ({ mode: "anthropic-adaptive", applied: "auto" }),
        claudeCodeCliVersion: async () => "fixture-version",
        classifyError: (opts: { status: number; body: string }) => ({ message: `${opts.status}: ${opts.body}` }),
        refreshClaudeCode: async (opts: { account?: string; rejectedToken?: string }) => {
            refreshes.push(opts);
            return opts.rejectedToken ? "replacement" : "rejected";
        },
        getAnthropicOAuthToken: async () => "rejected",
        connectFetch: async (opts: { url: string; init: RequestInit }) => {
            sent.push(opts);
            if (sent.length === 1) return new Response(new ReadableStream({
                start(controller) { controller.enqueue(new TextEncoder().encode("original unauthorized")); },
                cancel() { cancelled = true; },
            }), { status: 401 });
            expect(cancelled).toBe(true);
            if (retryStatus !== 200) return new Response("still unauthorized", { status: retryStatus });
            if (route === "stream") return new Response([
                'event: message_start\ndata: {"message":{"usage":{"input_tokens":2}}}\n\n',
                'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"ok"}}\n\n',
                'event: message_delta\ndata: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
            ].join(""), { headers: { "content-type": "text/event-stream" } });
            return Response.json({ content: route === "compact" ? [block] : [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: {} });
        },
        claudePoolSelect: async () => ({ enabled: false }),
        fetchClaude: (opts: Parameters<typeof fetchClaude>[2]) => fetchClaude(ctx, null, opts),
        parseSSE: (opts: Parameters<typeof parseSSE>[2]) => parseSSE(ctx, null, opts),
        toAnthropicMessages: (opts: Parameters<typeof toAnthropicMessages>[2]) => toAnthropicMessages(ctx, null, opts),
        call: (opts: Parameters<typeof call>[2]) => call(ctx, null, opts),
        streamAnthropic: (opts: Parameters<typeof streamAnthropic>[2]) => streamAnthropic(ctx, null, opts),
        compactAnthropic: (opts: Parameters<typeof compactAnthropic>[2]) => compactAnthropic(ctx, null, opts),
    });
    Object.assign(ctx.fns.agent, {
        buildLlmRequest: async () => ({ system: "fixture", messages: [{ role: "user", content: "hi" }] }),
        wireTools: () => [],
    });
    Object.assign(ctx.fns.node, {
        authorize: async () => ({ ok: true, client: { name: "fixture-client", providers: [provider] }, hops: 0 }),
        catalog: async () => [{ id: "claude-test", api: "anthropic", provider, account: "work" }],
        upstream: async () => ({ url: endpoint.url, headers: { authorization: "Bearer rejected", "content-type": "application/json", "anthropic-beta": "fixture-identity" } }),
        relay: (opts: Parameters<typeof relay>[2]) => relay(ctx, null, opts),
    });
    const model = `${provider}/work:claude-test`;
    const run = async (): Promise<any> => {
        if (route === "call") return ctx.fns.llm.call({ model, user: "hi", noFallback: true });
        if (route === "stream") return ctx.fns.llm.streamAnthropic({ agent: { id: "fixture", model, messages: [], scratchpad: {} } });
        if (route === "compact") return ctx.fns.llm.compactAnthropic({ model, messages: [{ role: "user", content: "hi" }] });
        return ctx.fns.node.relay({ api: "anthropic", req: new Request("https://fixture.invalid/anthropic", {
            method: "POST", headers: { "anthropic-beta": "compact-2026-09-04" }, body: JSON.stringify({ model: "claude-test", messages: [{ role: "user", content: "hi" }] }),
        }) });
    };
    return { run, sent, refreshes };
}

for (const route of routes) describe(`${route} real entry point Claude Code 401 recovery`, () => {
    test("replays once with the exact account/rejected bearer and preserves body/identity", async () => {
        const f = fixture(route);
        const result = await f.run();
        if (route === "relay") expect((await result.json()).content[0].text).toBe("ok");
        else if (route === "compact") expect(result.block).toEqual(block);
        else expect(result.text).toBe("ok");
        expect(f.sent).toHaveLength(2);
        const [first, second] = f.sent;
        expect(new Headers(first!.init.headers).get("authorization")).toBe("Bearer rejected");
        expect(new Headers(second!.init.headers).get("authorization")).toBe("Bearer replacement");
        expect(second!.url).toBe(first!.url);
        expect(second!.init.body).toBe(first!.init.body);
        expect(second!.init.signal).toBe(first!.init.signal);
        expect(new Headers(second!.init.headers).get("anthropic-beta")).toBe(new Headers(first!.init.headers).get("anthropic-beta"));
        expect(f.refreshes).toEqual([
            ...(route === "relay" ? [] : [{ account: "work" }]),
            { account: "work", rejectedToken: "rejected" },
        ]);
    });

    test("second 401 is surfaced without a third send or second recovery", async () => {
        const f = fixture(route, "claude-code", 401);
        if (route === "relay") expect((await f.run()).status).toBe(401);
        else await expect(f.run()).rejects.toThrow("401");
        expect(f.sent).toHaveLength(2);
        expect(f.refreshes.filter(opts => opts.rejectedToken)).toEqual([{ account: "work", rejectedToken: "rejected" }]);
    });
});
