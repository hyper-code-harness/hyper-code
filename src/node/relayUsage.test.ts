import { describe, expect, test } from "bun:test";
import relay from "./relay";
import upstream from "./upstream";
import modelsRoute from "./$route_v1_models_GET";
import usageRoute from "./$route_v1_usage_GET";
import usageRun from "../llmUsage/run";
import usageState from "../llmUsage/getState";

// Contract-level integration: no DB, settings, credential reads or external requests.
// The ledger spy never consumes bodies; its observer lifecycle is tested by llmUsage.
function mkTestCtx() {
    const calls: Record<string, unknown>[] = [];
    const attempts: Record<string, unknown>[] = [];
    const failures: unknown[] = [];
    let active = false;
    const registry: any = {
        node: {
            relay,
            authorize: async () => ({ ok: true, client: { id: "client-1", name: "trusted-peer", providers: ["openai"] }, hops: 0 }),
            catalog: async () => [{ id: "model-x", api: "openai", provider: "openai", account: "requested" }],
            upstream: async () => ({ url: "https://provider.test/chat/completions", provider: "openai", account: "resolved", kind: "api", headers: { authorization: "Bearer fake-test-credential", "content-type": "application/json" } }),
        },
        llm: {},
        llmUsage: {
            run: async (_c: any, _s: any, { fn, ...meta }: any) => {
                calls.push(meta);
                active = true;
                try { return await fn(); }
                catch (error) { failures.push(error); throw error; }
                finally { active = false; }
            },
            fetch: async (_c: any, _s: any, { send, ...meta }: any) => {
                expect(active).toBe(true);
                attempts.push(meta);
                return send();
            },
        },
        procs: { log: { info: () => {} }, project: { name: () => "test-host" } },
    };
    const ctx: any = { env: {}, state: { registry } };
    const proxy = (obj: any): any => new Proxy({}, { get: (_target, key) => {
        const value = obj?.[key];
        return typeof value === "function" ? (opts: any) => value(ctx, null, opts) : value && typeof value === "object" ? proxy(value) : value;
    } });
    ctx.fns = proxy(registry);
    return { ctx, registry, calls, attempts, failures };
}

function request(api = "openai", body = JSON.stringify({ model: "model-x", stream: false })) {
    return new Request(`http://relay.test/${api}`, { method: "POST", body,
        headers: { "x-hyper-origin": "untrusted-origin", "x-hyper-client-id": "spoof", "x-hyper-hops": "9" } });
}

async function withFetch(fn: (...args: Parameters<typeof fetch>) => Response | Promise<Response>, body: () => Promise<void>) {
    const previous = globalThis.fetch;
    globalThis.fetch = fn as typeof fetch;
    try { await body(); } finally { globalThis.fetch = previous; }
}

describe("node relay accounting boundary", () => {
    test("direct call uses authenticated client and resolved credential labels exactly once", async () => {
        const { ctx, calls, attempts } = mkTestCtx();
        const payload = '{"usage":{"prompt_tokens":12,"completion_tokens":4}}';
        let sends = 0;
        await withFetch((_url, init) => {
            sends++;
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-test-credential");
            return new Response(payload, { headers: { "content-type": "application/json", "x-request-id": "request-1", "x-ratelimit-remaining": "8" } });
        }, async () => {
            const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
            expect(res.status).toBe(200);
            expect(res.headers.get("x-request-id")).toBe("request-1");
            expect(res.headers.get("x-ratelimit-remaining")).toBe("8");
            expect(await res.text()).toBe(payload);
        });
        expect(sends).toBe(1);
        expect(calls).toEqual([{ operation: "relay", source: "node", clientId: "client-1", clientName: "trusted-peer", requestedModel: "model-x" }]);
        expect(attempts).toEqual([{ provider: "openai", account: "resolved", model: "model-x", api: "openai" }]);
    });

    for (const status of [429, 500]) test(`HTTP ${status} records one send without retrying or changing body`, async () => {
        const { ctx, calls, attempts } = mkTestCtx();
        await withFetch(() => new Response("failure", { status, headers: { "retry-after": "5" } }), async () => {
            const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
            expect(res.status).toBe(status);
            expect(res.headers.get("retry-after")).toBe("5");
            expect(await res.text()).toBe("failure");
        });
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(1);
    });

    test("connect error remains one failed logical call and one attempt", async () => {
        const { ctx, calls, attempts, failures } = mkTestCtx();
        const error = new Error("test connect failure");
        await withFetch(() => { throw error; }, async () => {
            await expect(ctx.fns.node.relay({ req: request(), api: "openai" })).rejects.toBe(error);
        });
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(1);
        expect(failures).toEqual([error]);
    });

    test("pre-send pool exhaustion belongs to the call and preserves quota response", async () => {
        const { ctx, registry, calls, attempts, failures } = mkTestCtx();
        registry.node.upstream = async () => { throw Object.assign(new Error("all spent"), { failure: {
            provider: "claude-pool", kind: "usage_limit", message: "all spent", resetsAt: Date.now() + 60_000,
        } }); };
        const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
        expect(res.status).toBe(429);
        expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(0);
        expect(failures).toHaveLength(1);
    });

    test("missing credentials stay a 503 logical call with no physical attempt", async () => {
        const { ctx, registry, calls, attempts } = mkTestCtx();
        registry.node.upstream = async () => null;
        const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
        expect(res.status).toBe(503);
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(0);
    });

    test("real disabled run performs no ledger writes and preserves the relay response", async () => {
        const { ctx, registry, calls, attempts } = mkTestCtx();
        registry.llmUsage.run = usageRun;
        registry.llmUsage.getState = usageState;
        registry.llmUsage.persist = async () => { throw new Error("disabled ledger must not persist"); };
        registry.settings = { get: async () => false };
        registry.llmUsage.fetch = async (_c: any, _s: any, opts: any) => {
            expect(ctx.state.llmUsage.storage.getStore()).toBeUndefined();
            return opts.send();
        };
        await withFetch(() => new Response("unobserved"), async () => {
            const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
            expect(await res.text()).toBe("unobserved");
        });
        expect(calls).toHaveLength(0);
        expect(attempts).toHaveLength(0);
    });

    test("stream bytes, lazy reads and downstream cancellation pass through without a second attempt", async () => {
        const { ctx, calls, attempts } = mkTestCtx();
        let pulls = 0;
        let cancelled: unknown;
        const bytes = new TextEncoder().encode('data: {"usage":{"prompt_tokens":4}}\n\n');
        const source = new ReadableStream<Uint8Array>({
            pull(controller) { pulls++; controller.enqueue(bytes); },
            cancel(reason) { cancelled = reason; },
        }, { highWaterMark: 0 });
        await withFetch(() => new Response(source, { headers: { "content-type": "text/event-stream" } }), async () => {
            const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
            expect(pulls).toBe(0);
            const reader = res.body!.getReader();
            expect((await reader.read()).value).toEqual(bytes);
            await reader.cancel("downstream cancelled");
            expect(cancelled).toBe("downstream cancelled");
        });
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(1);
    });

    test("accepted stream failure is passed through and never replayed", async () => {
        const { ctx, calls, attempts } = mkTestCtx();
        const error = new Error("test stream failure");
        const source = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(error); } }, { highWaterMark: 0 });
        await withFetch(() => new Response(source, { headers: { "content-type": "text/event-stream" } }), async () => {
            const res = await ctx.fns.node.relay({ req: request(), api: "openai" });
            expect(res.status).toBe(200);
            await expect(res.text()).rejects.toBe(error);
        });
        expect(calls).toHaveLength(1);
        expect(attempts).toHaveLength(1);
    });

    test("Claude owns physical attempts and final account; relay does not wrap it twice", async () => {
        const { ctx, registry, calls, attempts } = mkTestCtx();
        registry.node.catalog = async () => [{ id: "model-x", api: "anthropic", provider: "claude-code", account: "requested" }];
        registry.llm.fetchClaude = async (_c: any, _s: any, opts: any) => {
            expect(opts.provider).toBe("claude-code");
            expect(opts.account).toBe("requested");
            // Simulates the agreed physical-send contract, not pool selection itself.
            const first = await ctx.fns.llmUsage.fetch({ provider: "anthropic-oauth", account: "pool-a", model: "model-x", api: "anthropic", send: async () => new Response("spent", { status: 429 }) });
            await first.body.cancel();
            const response = await ctx.fns.llmUsage.fetch({ provider: "anthropic-oauth", account: "pool-b", model: "model-x", api: "anthropic", send: async () => Response.json({ usage: { input_tokens: 3, output_tokens: 5 } }) });
            return { response, provider: "anthropic-oauth", account: "pool-b", pooled: true };
        };
        const res = await ctx.fns.node.relay({ req: request("anthropic"), api: "anthropic" });
        expect(res.status).toBe(200);
        expect((await res.json()).usage.output_tokens).toBe(5);
        expect(calls).toHaveLength(1);
        expect(attempts.map(item => item.account)).toEqual(["pool-a", "pool-b"]);
    });

    test("intermediary hop forwards once without starting a call or entering an observer", async () => {
        const { ctx, registry, calls, attempts } = mkTestCtx();
        registry.node.catalog = async () => [{ id: "model-x", api: "anthropic", provider: "claude-code", via: "hyper/next" }];
        registry.node.get = async () => ({ url: "http://next.test" });
        registry.node.token = async () => "fake-node-token";
        registry.node.upstream = async () => { throw new Error("must not resolve local credentials"); };
        let sends = 0;
        await withFetch((_url, init) => {
            sends++;
            expect(new Headers(init?.headers).get("x-hyper-hops")).toBe("1");
            return new Response("forwarded");
        }, async () => {
            const res = await ctx.fns.node.relay({ req: request("anthropic"), api: "anthropic" });
            expect(await res.text()).toBe("forwarded");
        });
        expect(sends).toBe(1);
        expect(calls).toHaveLength(0);
        expect(attempts).toHaveLength(0);
    });

    test("models and quota routes are not inference calls", async () => {
        const { ctx, registry, calls, attempts } = mkTestCtx();
        registry.llm.usageOverview = async () => [];
        expect((await modelsRoute(ctx, null, { req: new Request("http://relay.test/models") })).status).toBe(200);
        expect((await usageRoute(ctx, null, { req: new Request("http://relay.test/usage") })).status).toBe(200);
        expect(calls).toHaveLength(0);
        expect(attempts).toHaveLength(0);
    });

    test("denied, malformed and unavailable-model requests never start inference accounting", async () => {
        const { ctx, registry, calls, attempts } = mkTestCtx();
        expect((await ctx.fns.node.relay({ req: request("openai", "not-json"), api: "openai" })).status).toBe(400);
        expect((await ctx.fns.node.relay({ req: request("openai", '{"model":"absent"}'), api: "openai" })).status).toBe(404);
        registry.node.authorize = async () => ({ ok: false, response: new Response(null, { status: 401 }) });
        expect((await ctx.fns.node.relay({ req: request(), api: "openai" })).status).toBe(401);
        expect(calls).toHaveLength(0);
        expect(attempts).toHaveLength(0);
    });

    test("upstream returns resolved safe identity rather than requested account", async () => {
        const { ctx, registry } = mkTestCtx();
        registry.node.upstream = upstream;
        registry.llm.resolveEndpoint = async () => ({ provider: "anthropic-oauth", account: "pool-active", api: "anthropic", kind: "subscription", url: "https://provider.test/messages", apiKey: null });
        registry.llm.getAnthropicOAuthToken = async (_c: any, _s: any, opts: any) => { expect(opts.account).toBe("pool-active"); return "fake-managed-token"; };
        registry.llm.claudeCodeCliVersion = async () => "test";
        const up = await ctx.fns.node.upstream({ provider: "claude-code", account: "requested", api: "anthropic" });
        expect(up.provider).toBe("anthropic-oauth");
        expect(up.account).toBe("pool-active");
    });
});
