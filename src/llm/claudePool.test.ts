import { beforeEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

const url = "https://api.anthropic.com/v1/messages";
const body = JSON.stringify({ model: "claude-fable-5-1", stream: true, messages: [{ role: "user", content: "ok" }] });
let c: any;
let sent: Array<{ token: string; body: string }>;
let usageFetches: number;
const now = Date.now();

async function quota(account: string, primary: number, at = now + 600_000, secondary = 0, week = now + 86_400_000) {
    await c.fns.llm.recordUsage({ provider: "anthropic-oauth", account, headers: {
        "anthropic-ratelimit-unified-5h-utilization": String(primary / 100),
        "anthropic-ratelimit-unified-5h-reset": String(at / 1000),
        "anthropic-ratelimit-unified-7d-utilization": String(secondary / 100),
        "anthropic-ratelimit-unified-7d-reset": String(week / 1000),
    }, now });
}
async function current(account: string) {
    await c.fns.procs.db.run({ sql: "INSERT INTO kv(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", params: ["llm:claude-pool:current", account] });
}
async function request(provider = "claude-code", account = "work") {
    return c.fns.llm.fetchClaude({ provider, account, url, init: { method: "POST", headers: { authorization: "Bearer original", "anthropic-beta": "identity,compact", "x-api-key": "old" }, body } });
}
function responseFor(fn: (account: string) => Response | Promise<Response>) {
    c.state.registry.llm.connectFetch = async (_: any, __: any, o: any) => {
        const headers = new Headers(o.init.headers);
        const token = headers.get("authorization")!;
        sent.push({ token, body: o.init.body });
        expect(headers.get("anthropic-beta")).toBe("identity,compact");
        expect(headers.has("x-api-key")).toBe(false);
        return fn(token.replace("Bearer token-", ""));
    };
}
const exhausted = (reset = now + 600_000) => Response.json({ error: { type: "usage_limit_reached", resets_at: reset / 1000 } }, { status: 429 });

beforeEach(async () => {
    c = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } });
    await c.fns.settings.set({ module: "llm", scopeType: "global", key: "claudeSubscriptionPool", value: true });
    for (const account of ["adam", "hs", "work"]) await c.fns.llm.saveAnthropicOAuth({ account, access: `token-${account}`, refresh: `refresh-${account}`, expiresAt: Date.now() + 3_600_000 });
    c.state.registry.ui.notify = async () => {};
    // Enabled pool aliases must never open the external CLI credential store.
    c.state.registry.llm.refreshClaudeCode = async () => { throw new Error("pool must not read CLI credentials"); };
    sent = [];
    usageFetches = 0;
    c.state.registry.llm.refreshUsage = async () => { usageFetches++; return []; };
});

describe("shared managed Claude subscription pool (isolated Postgres)", () => {
    test("skips spent current, is sticky, and maps every Claude alias without changing model", async () => {
        await quota("work", 100);
        await current("work");
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
        await quota("work", 0, now - 1);
        for (const model of ["claude-code:claude-fable-5-1", "claude-code/work:claude-fable-5-1", "anthropic-oauth/hs:claude-fable-5-1"]) {
            expect(await c.fns.llm.resolveEndpoint({ model })).toMatchObject({ provider: "anthropic-oauth", account: "adam", modelId: "claude-fable-5-1" });
        }
        expect((await c.fns.llm.resolveEndpoint({ model: "anthropic:claude-fable-5-1" })).provider).toBe("anthropic");
    });

    test("concurrent selection and simultaneous failures converge without skipping the healthy account", async () => {
        await current("work");
        const values = await Promise.all(Array.from({ length: 12 }, () => c.fns.llm.claudePoolSelect({ failedAccount: "work", resetsAt: now + 600_000 })));
        expect(new Set(values.map((v: any) => v.account))).toEqual(new Set(["adam"]));
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
    });

    test("all exhausted waits for earliest usable account, respecting both quota windows", async () => {
        await quota("adam", 100, now + 60_000, 100, now + 600_000);
        await quota("hs", 100, now + 120_000);
        await quota("work", 100, now + 300_000);
        const pool = await c.fns.llm.claudePoolSelect({ now });
        expect(pool.account).toBeNull();
        expect(pool.resetsAt).toBe(now + 120_000);
        await expect(c.fns.llm.resolveEndpoint({ model: "claude-code:claude-fable-5-1" })).rejects.toMatchObject({ failure: { provider: "claude-pool", kind: "usage_limit", resetsAt: now + 120_000 } });
        expect((await c.fns.llm.claudePoolSelect({ now: now + 121_000 })).account).toBe("hs");
    });

    test("late success cannot erase failure cooldown; cooldown expires", async () => {
        await current("adam");
        await c.fns.llm.claudePoolSelect({ failedAccount: "adam", resetsAt: now + 100_000, now });
        await quota("adam", 1);
        await current("adam");
        expect((await c.fns.llm.claudePoolSelect({ now })).account).toBe("hs");
        await current("adam");
        expect((await c.fns.llm.claudePoolSelect({ now: now + 101_000 })).account).toBe("adam");
    });

    test("expired access tokens are eligible for refresh, not mistaken for exhausted quota", async () => {
        await c.fns.procs.db.run({ sql: "UPDATE oauth_credentials SET expires_at=? WHERE provider=? AND account=?", params: [now - 1, "anthropic-oauth", "adam"] });
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
    });

    test("disabled pool preserves named account and original authorization", async () => {
        await c.fns.settings.set({ module: "llm", scopeType: "global", key: "claudeSubscriptionPool", value: false });
        expect((await c.fns.llm.resolveEndpoint({ model: "anthropic-oauth/work:claude-x" })).account).toBe("work");
        c.state.registry.llm.connectFetch = async (_: any, __: any, o: any) => { expect(new Headers(o.init.headers).get("authorization")).toBe("Bearer original"); return new Response("ok"); };
        expect(await request()).toMatchObject({ provider: "claude-code", account: "work", pooled: false });
    });

    test("confirmed quota failure retries once on another account preserving exact request", async () => {
        await current("adam");
        responseFor(account => account === "adam" ? exhausted() : new Response("stream"));
        const result = await request();
        expect(result).toMatchObject({ provider: "anthropic-oauth", account: "hs", pooled: true });
        expect(await result.response.text()).toBe("stream");
        expect(sent).toEqual([{ token: "Bearer token-adam", body }, { token: "Bearer token-hs", body }]);
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("hs");
        expect(usageFetches).toBe(0);
    });

    test("all fail: bounded attempts and parkable pool error, no fallback to CLI or API key", async () => {
        responseFor(() => exhausted());
        await expect(request()).rejects.toMatchObject({ failure: { provider: "claude-pool", kind: "usage_limit" } });
        expect(sent.length).toBe(3);
        expect(new Set(sent.map(v => v.token)).size).toBe(3);
    });

    test("plain throttling is not exhaustion; checks quota but never switches healthy account", async () => {
        responseFor(() => Response.json({ error: { type: "rate_limit_error", message: "too many requests" } }, { status: 429 }));
        const result = await request();
        expect(result.response.status).toBe(429);
        expect(result.account).toBe("adam");
        expect(sent.length).toBe(1);
        expect(usageFetches).toBe(1);
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
    });

    test("generic 429 rotates only when authoritative usage confirms exhaustion", async () => {
        c.state.registry.llm.refreshUsage = async () => { usageFetches++; await quota("adam", 100); return []; };
        responseFor(account => account === "adam" ? Response.json({ error: { type: "rate_limit_error" } }, { status: 429 }) : new Response("ok"));
        expect((await request()).account).toBe("hs");
        expect(sent.length).toBe(2);
        expect(usageFetches).toBe(1);
    });

    for (const status of [400, 401, 403, 500, 529]) test(`HTTP ${status} is returned unchanged, not hidden by rotation`, async () => {
        responseFor(() => new Response("original error", { status }));
        const result = await request();
        expect(result.response.status).toBe(status);
        expect(await result.response.text()).toBe("original error");
        expect(sent.length).toBe(1);
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
    });

    test("aborted request never sends, successful partial stream never replays", async () => {
        responseFor(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("partial")); controller.close(); } })));
        await expect(c.fns.llm.fetchClaude({ provider: "claude-code", url, init: { body, signal: AbortSignal.abort() } })).rejects.toThrow();
        expect(sent.length).toBe(0);
        const result = await request();
        expect(await result.response.text()).toBe("partial");
        expect(sent.length).toBe(1);
    });

    test("pool refuses to leak managed credentials to a remote endpoint", async () => {
        responseFor(() => new Response("unexpected"));
        await expect(c.fns.llm.fetchClaude({ provider: "claude-code", url: "https://other.test/v1/messages", init: { body } })).rejects.toThrow("Anthropic Messages endpoint");
        expect(sent.length).toBe(0);
    });

    test("pool exhaustion never falls through to another model in llm.call", async () => {
        await c.fns.settings.set({ module: "llm", scopeType: "global", key: "fallbackModels", value: "mock:echo" });
        for (const a of ["adam", "hs", "work"]) await quota(a, 100);
        await expect(c.fns.llm.call({ model: "claude-code:claude-fable-5-1", user: "ok" })).rejects.toMatchObject({ failure: { provider: "claude-pool" } });
    });

    test("accepted response survives quota telemetry failure without a replay", async () => {
        c.state.registry.llm.recordUsage = async () => { throw new Error("test-only database unavailable"); };
        responseFor(() => new Response("ok"));
        expect(await (await request()).response.text()).toBe("ok");
        expect(sent.length).toBe(1);
    });

    test("local call and compaction share the current account and preserve model/body", async () => {
        await quota("work", 100);
        await current("work");
        const seen: any[] = [];
        c.state.registry.llm.claudeCodeCliVersion = async () => "test";
        c.state.registry.llm.connectFetch = async (_: any, __: any, o: any) => {
            seen.push({ auth: new Headers(o.init.headers).get("authorization"), body: JSON.parse(o.init.body) });
            return Response.json({ content: [{ type: "text", text: "ok" }, { type: "compaction", content: "summary", signature: "signed" }], stop_reason: "end_turn", usage: {} });
        };
        expect((await c.fns.llm.call({ model: "claude-code/work:claude-fable-5-1", user: "ok", noFallback: true })).text).toBe("ok");
        expect((await c.fns.llm.compactAnthropic({ model: "anthropic-oauth/work:claude-fable-5-1", messages: [{ role: "user", content: "hi" }] })).block.signature).toBe("signed");
        expect(seen.map(s => s.auth)).toEqual(["Bearer token-adam", "Bearer token-adam"]);
        expect(seen.map(s => s.body.model)).toEqual(["claude-fable-5-1", "claude-fable-5-1"]);
        expect(seen[1].body.compaction).toEqual({ type: "summarize" });
        expect(seen[0].body.system[0].text).toContain("You are Claude Code");
    });

    test("Claude Code compaction and relay upstream bypass CLI credentials when pool is enabled", async () => {
        c.state.registry.llm.claudeCodeCliVersion = async () => "test";
        c.state.registry.llm.connectFetch = async (_: any, __: any, o: any) => {
            expect(new Headers(o.init.headers).get("authorization")).toBe("Bearer token-adam");
            return Response.json({ content: [{ type: "compaction", content: "summary", signature: "signed" }], stop_reason: "end_turn" });
        };
        const compacted = await c.fns.llm.compactAnthropic({ model: "claude-code/work:claude-fable-5-1", messages: [{ role: "user", content: "hi" }] });
        expect(compacted.block.signature).toBe("signed");
        const up = await c.fns.node.upstream({ provider: "claude-code", account: "work", api: "anthropic" });
        expect(up?.headers.authorization).toBe("Bearer token-adam");
    });

    test("real streaming transport rotates before first delta and attributes quota to the used account", async () => {
        c.state.registry.agent.buildLlmRequest = async () => ({ system: "sys", messages: [{ role: "user", content: "hi" }] });
        c.state.registry.agent.wireTools = () => [];
        c.state.registry.agent.cacheRoot = async () => "pool-test";
        c.state.registry.llm.claudeCodeCliVersion = async () => "test";
        const auth: string[] = [];
        c.state.registry.llm.connectFetch = async (_: any, __: any, o: any) => {
            const token = new Headers(o.init.headers).get("authorization")!;
            auth.push(token);
            expect(JSON.parse(o.init.body).thinking).toBeUndefined();
            if (token === "Bearer token-adam") return exhausted();
            return new Response('event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"ok"}}\n\nevent: message_delta\ndata: {"delta":{"stop_reason":"end_turn"}}\n\n', { headers: { "content-type": "text/event-stream", "anthropic-ratelimit-unified-5h-utilization": "0.2" } });
        };
        const deltas: string[] = [];
        const a = { id: "pool-test", model: "claude-code/work:claude-fable-5-1", messages: [], scratchpad: {} };
        const result = await c.fns.llm.streamAnthropic({ agent: a, onEvent: (e: any) => { if (e.type === "text_delta") deltas.push(e.delta); } });
        expect(result.text).toBe("ok");
        expect(deltas).toEqual(["ok"]);
        expect(auth).toEqual(["Bearer token-adam", "Bearer token-hs"]);
        const stats = await c.fns.llm.usageOverview({});
        expect(stats.find((s: any) => s.account === "adam").usedPercent).toBe(100);
        expect(stats.find((s: any) => s.account === "hs").usedPercent).toBe(20);
        expect(a.model).toBe("claude-code/work:claude-fable-5-1");
    });

    test("existing claude-code-only relay grants keep models with managed-only logins, including when exhausted", async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response("", { status: 503 })) as any;
        c.state.registry.llm.listAccounts = async () => ["adam", "hs", "work"].map(account => ({ provider: "anthropic-oauth", account, source: "oauth", needsReconnect: false }));
        c.state.registry.node.list = async () => [];
        try {
            const models = await c.fns.llm.listModels({ skipNodes: true });
            expect(models["claude-code"]).toContain("claude-code:claude-fable-5-1");
            for (const a of ["adam", "hs", "work"]) await quota(a, 100);
            const catalog = await c.fns.node.catalog({ providers: ["claude-code"] });
            expect(catalog.some((e: any) => e.id === "claude-fable-5-1" && e.provider === "claude-code")).toBe(true);
            expect(await c.fns.node.catalog({ providers: ["codex"] })).toEqual([]);
            c.state.registry.node.authorize = async () => ({ ok: true, client: { name: "test-client", providers: ["claude-code"] }, hops: 0 });
            const r = await c.fns.node.relay({ api: "anthropic", req: new Request("http://localhost/node/v1/anthropic", { method: "POST", body }) });
            expect(r.status).toBe(429);
            expect((await r.json()).error.type).toBe("usage_limit_reached");
        } finally { globalThis.fetch = originalFetch; }
    });

    test("manual selection updates shared account, rejects spent or unknown, then rotates automatically", async () => {
        await quota("work", 100);
        expect((await c.fns.llm.claudePoolSelect({ preferredAccount: "hs" })).account).toBe("hs");
        await expect(c.fns.llm.claudePoolSelect({ preferredAccount: "work" })).rejects.toThrow("exhausted");
        await expect(c.fns.llm.claudePoolSelect({ preferredAccount: "unknown" })).rejects.toThrow("missing");
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("hs");
        expect((await c.fns.llm.claudePoolSelect({ failedAccount: "hs", resetsAt: now + 600_000 })).account).toBe("adam");
    });

    test("setModel separates model from the explicit subscription choice and affects other Claude callers", async () => {
        const a = await c.fns.agent.start({ model: "mock:echo", title: "test" });
        c.state.registry.agent.autoCompactIfNeeded = async () => {};
        const result = await c.fns.agent.setModel({ id: a.id, model: "anthropic-oauth/work:claude-fable-5-1", claudeAccount: "hs" });
        expect(result.model).toBe("claude-code:claude-fable-5-1");
        expect((await c.fns.llm.resolveEndpoint({ model: "claude-code/work:claude-sonnet-4-6" })).account).toBe("hs");
        const again = await c.fns.agent.setModel({ id: a.id, model: result.model, claudeAccount: "adam" });
        expect(again.changed).toEqual([a.id]);
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
        await expect(c.fns.agent.setModel({ id: "missing-id", model: result.model, claudeAccount: "hs" })).rejects.toThrow("not found");
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
    });

    test("new-agent form applies an account only on valid submission and stores a canonical model", async () => {
        c.state.registry.workspace.normalize = async () => "/test-workspace";
        const fail = await c.fns.agent.createFromValues({ model: "claude-code:claude-fable-5-1", claudeAccount: "hs", systemPromptName: "__custom", systemPromptCore: "" });
        expect(fail.error).toBe("Own system prompt is empty");
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("adam");
        const result = await c.fns.agent.createFromValues({ model: "anthropic-oauth/work:claude-fable-5-1", claudeAccount: "hs" });
        expect(result.error).toBeUndefined();
        expect(result.agent.model).toBe("claude-code:claude-fable-5-1");
        expect((await c.fns.llm.claudePoolSelect({})).account).toBe("hs");
    });
});
