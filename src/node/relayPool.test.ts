import { expect, test } from "bun:test";
import relay from "./relay";
import upstream from "./upstream";

// Isolated registry: no Postgres, credentials, settings or external requests.
async function mkTestCtx(): Promise<any> {
    const registry: any = { node: { relay, upstream }, llm: {}, procs: { log: { info: () => {} } } };
    const ctx: any = { state: { registry }, env: {} };
    const proxy = (obj: any): any => new Proxy({}, { get: (_t, key) => typeof obj[key] === "function"
        ? (opts: any) => obj[key](ctx, null, opts) : proxy(obj[key]) });
    ctx.fns = proxy(registry);
    return ctx;
}

for (const source of ["upstream", "fetchClaude"]) test(`relay pool exhaustion from ${source} becomes quota 429`, async () => {
    const ctx: any = await mkTestCtx();
    const reg = ctx.state.registry;
    const resetsAt = Date.now() + 90_123;
    reg.node.authorize = async () => ({ ok: true, client: { name: "c" }, hops: 0 });
    reg.node.catalog = async () => [{ id: "claude-x", api: "anthropic", provider: "anthropic-oauth", account: "old" }];
    reg.node.upstream = async () => ({ url: "https://unused.test", headers: {} });
    const fail = async () => { throw Object.assign(new Error("spent"), { failure: { provider: "claude-pool", account: "default", kind: "usage_limit", message: "All accounts spent", resetsAt } }); };
    if (source === "upstream") reg.node.upstream = fail;
    else reg.llm.fetchClaude = fail;
    const res = await ctx.fns.node.relay({ req: new Request("http://host/anthropic", { method: "POST", body: JSON.stringify({ model: "claude-x" }) }), api: "anthropic" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await res.json()).toEqual({ error: { type: "usage_limit_reached", message: "All accounts spent", resets_at: Math.ceil(resetsAt / 1000) } });
});

test("chained quota response is forwarded once without pool access", async () => {
    const ctx: any = await mkTestCtx();
    const reg = ctx.state.registry;
    reg.node.authorize = async () => ({ ok: true, client: { name: "c" }, hops: 1 });
    reg.node.catalog = async () => [{ id: "claude-x", api: "anthropic", provider: "claude-code", via: "hyper/next" }];
    reg.node.get = async () => ({ url: "http://next" });
    reg.node.token = async () => "node-token";
    reg.llm.fetchClaude = async () => { throw new Error("must not pool chained requests"); };
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: any, init: any) => {
        calls++;
        expect(init.headers.authorization).toBe("Bearer node-token");
        expect(init.headers["x-hyper-hops"]).toBe("2");
        return new Response("quota", { status: 429, headers: { "retry-after": "90" } });
    }) as any;
    try {
        const res = await ctx.fns.node.relay({ req: new Request("http://host/anthropic", { method: "POST", body: JSON.stringify({ model: "claude-x" }) }), api: "anthropic" });
        expect(res.status).toBe(429);
        expect(res.headers.get("retry-after")).toBe("90");
        expect(await res.text()).toBe("quota");
        expect(calls).toBe(1);
    } finally { globalThis.fetch = realFetch; }
});

test("direct relay delegates unchanged body, identity headers and requested account to pool", async () => {
    const ctx: any = await mkTestCtx();
    const reg = ctx.state.registry;
    reg.node.authorize = async () => ({ ok: true, client: { name: "c", providers: ["claude-code"] }, hops: 0 });
    reg.node.catalog = async (_c: any, _s: any, o: any) => {
        expect(o.providers).toEqual(["claude-code"]);
        return [{ id: "claude-x", api: "anthropic", provider: "claude-code", account: "old" }];
    };
    reg.node.upstream = async () => ({ url: "https://unused.test/messages", headers: { authorization: "Bearer host-token", "user-agent": "claude-cli", "anthropic-beta": "oauth" } });
    const body = JSON.stringify({ model: "claude-x", messages: [{ role: "user", content: "hi" }], stream: true });
    reg.llm.fetchClaude = async (_c: any, _s: any, o: any) => {
        expect(o.provider).toBe("claude-code");
        expect(o.account).toBe("old");
        expect(o.url).toBe("https://unused.test/messages");
        expect(o.init.body).toBe(body);
        expect(o.init.headers.authorization).toBe("Bearer host-token");
        expect(o.init.headers["user-agent"]).toBe("claude-cli");
        expect(o.init.headers["anthropic-beta"]).toBe("oauth,compact");
        return { response: new Response("stream", { headers: { "content-type": "text/event-stream", "anthropic-ratelimit-requests-remaining": "5" } }), provider: "claude-code", account: "new", pooled: true };
    };
    const res = await ctx.fns.node.relay({ req: new Request("http://host/anthropic", { method: "POST", headers: { "anthropic-beta": "compact" }, body }), api: "anthropic" });
    expect(res.headers.get("anthropic-ratelimit-requests-remaining")).toBe("5");
    expect(await res.text()).toBe("stream");
});

test("upstream refresh uses resolved pool account, not original account", async () => {
    const ctx: any = await mkTestCtx();
    const reg = ctx.state.registry;
    reg.llm.resolveEndpoint = async () => ({ provider: "claude-code", account: "active", api: "anthropic", apiKey: null, kind: "subscription", url: "https://unused.test" });
    reg.llm.refreshClaudeCode = async (_c: any, _s: any, o: any) => { expect(o.account).toBe("active"); return "active-token"; };
    reg.llm.claudeCodeCliVersion = async () => "1";
    const up = await ctx.fns.node.upstream({ provider: "anthropic-oauth", account: "old", api: "anthropic" });
    expect(up.headers.authorization).toBe("Bearer active-token");
});
