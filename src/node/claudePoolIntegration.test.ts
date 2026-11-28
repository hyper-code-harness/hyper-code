import { expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// Real PostgreSQL, real loopback HTTP and real client authorization. Only the
// external Anthropic transport and CLI version discovery are substituted.
test("network relay shares the Claude pool, preserves ACLs and never replays accepted streams", async () => {
    const c = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64") } });
    await c.fns.settings.set({ module: "llm", scopeType: "global", key: "claudeSubscriptionPool", value: true });
    for (const account of ["integration-a", "integration-b"]) {
        await c.fns.llm.saveAnthropicOAuth({ account, access: `fake-${account}`, refresh: "fake-refresh", expiresAt: Date.now() + 3_600_000 });
    }
    c.state.registry.llm.claudeCodeCliVersion = async () => "test";
    // Supply a stable model inventory, keeping real catalog filtering and endpoint resolution.
    c.state.registry.llm.listModels = async () => ({ "anthropic-oauth": ["anthropic-oauth/integration-a:claude-test"] });
    const sent: string[] = [];
    let mode = "ok";
    c.state.registry.llm.connectFetch = async (_ctx: any, _session: any, opts: any) => {
        expect(opts.url).toBe("https://api.anthropic.com/v1/messages");
        const token = new Headers(opts.init.headers).get("authorization")!;
        sent.push(token);
        if (mode === "exhaust" || (mode === "switch" && token.endsWith("integration-a"))) {
            return Response.json({ error: { type: "usage_limit_reached", resets_at: Math.ceil((Date.now() + 600_000) / 1000) } }, { status: 429 });
        }
        if (mode === "partial") return new Response("event: content_block_delta\ndata: {\"delta\":{\"text\":\"partial\"}}\n\nevent: error\ndata: {\"error\":{\"type\":\"usage_limit_reached\"}}\n\n", { headers: { "content-type": "text/event-stream" } });
        return Response.json({ token });
    };
    const client = await c.fns.node.issueClient({ name: "integration-peer", providers: ["anthropic-oauth"] });
    const denied = await c.fns.node.issueClient({ name: "integration-denied", providers: ["openai"] });
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => c.fns.node.relay({ req, api: "anthropic" }) });
    c.state.procs.http.server = { server };
    const body = JSON.stringify({ model: "claude-test", stream: true, messages: [{ role: "user", content: "test" }] });
    const remote = (token = client.token) => fetch(server.url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body });
    try {
        expect((await remote("invalid-fake-client")).status).toBe(401);
        expect((await remote(denied.token)).status).toBe(404);
        expect(sent).toHaveLength(0);
        const local = await c.fns.llm.fetchClaude({ provider: "claude-code", account: "default", url: "https://api.anthropic.com/v1/messages", init: { method: "POST", body } });
        expect(local.account).toBe("integration-a");
        await local.response.text();
        expect(await (await remote()).json()).toMatchObject({ token: "Bearer fake-integration-a" });
        mode = "switch";
        expect(await (await remote()).json()).toMatchObject({ token: "Bearer fake-integration-b" });
        expect(sent.slice(-2)).toEqual(["Bearer fake-integration-a", "Bearer fake-integration-b"]);
        mode = "partial";
        const before = sent.length;
        const partial = await remote();
        expect(partial.status).toBe(200);
        expect(await partial.text()).toContain("partial");
        expect(sent.length).toBe(before + 1);
        mode = "exhaust";
        const exhausted = await remote();
        expect(exhausted.status).toBe(429);
        expect(Number(exhausted.headers.get("retry-after"))).toBeGreaterThan(0);
        expect(await exhausted.json()).toMatchObject({ error: { type: "usage_limit_reached" } });
        const count = sent.length;
        expect((await remote()).status).toBe(429);
        expect(sent.length).toBe(count);
    } finally { await server.stop(true); }
}, 60_000);
