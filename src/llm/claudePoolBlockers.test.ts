import { beforeEach, afterEach, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

let c: any;
let fetchBefore: typeof fetch;
const model = "claude-code:claude-fable-5-1";
const currentKey = "llm:claude-pool:current";
const messagesUrl = "https://api.anthropic.com/v1/messages";
const body = JSON.stringify({ model: "claude-fable-5-1", messages: [{ role: "user", content: "private prompt marker" }] });
const request = () => c.fns.llm.fetchClaude({ provider: "claude-code", account: "work", url: messagesUrl, init: { method: "POST", body } });
const current = async () => (await c.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key=?", params: [currentKey] }))[0]?.value;

beforeEach(async () => {
    c = await mkTestCtx({ env: { HYPER_OAUTH_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") } });
    await c.fns.settings.set({ module: "llm", scopeType: "global", key: "claudeSubscriptionPool", value: true });
    for (const account of ["adam", "work"]) await c.fns.llm.saveAnthropicOAuth({ account, access: `test-token-${account}`, refresh: `test-refresh-${account}`, expiresAt: Date.now() + 3_600_000 });
    await c.fns.procs.db.run({ sql: "INSERT INTO kv(key,value) VALUES (?,?)", params: [currentKey, "adam"] });
    c.state.registry.workspace.normalize = async () => "/test-workspace";
    c.state.registry.llm.refreshClaudeCode = async () => { throw new Error("must not read CLI credentials"); };
    c.state.registry.llm.claudeCodeCliVersion = async () => "test";
    c.state.registry.llm.connectFetch = async () => { throw new Error("unexpected HTTP request"); };
    fetchBefore = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("real HTTP forbidden in pool regression tests"); }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = fetchBefore; });

describe("shared Claude pool release blockers", () => {
    test("enabled pool without OAuth rows remains enabled and never falls back to CLI", async () => {
        await c.fns.procs.db.run({ sql: "DELETE FROM oauth_credentials WHERE provider=?", params: ["anthropic-oauth"] });
        expect(await c.fns.llm.claudePoolSelect({})).toEqual({ enabled: true, account: null, resetsAt: null, accounts: [] });
        await expect(c.fns.llm.resolveEndpoint({ model })).rejects.toMatchObject({ failure: { provider: "claude-pool", kind: "usage_limit" } });
        await expect(request()).rejects.toMatchObject({ failure: { provider: "claude-pool", kind: "usage_limit" } });
        await expect(c.fns.llm.claudePoolSelect({ preferredAccount: "adam" })).rejects.toThrow("No managed Claude subscriptions");
        c.env.ANTHROPIC_API_KEY = "api-key-test";
        expect(await c.fns.llm.resolveEndpoint({ model: "anthropic:claude-fable-5-1" })).toMatchObject({ provider: "anthropic", apiKey: "api-key-test" });
        expect((await c.fns.agent.createFromValues({ model })).error).toContain("No managed Claude subscription");
    });

    test("read-only selection and failure rejection do not write current, settings, auth or parking", async () => {
        const writes: string[] = [];
        for (const name of ["run", "insert", "exec"]) c.state.registry.procs.db[name] = async () => { writes.push(name); throw new Error("read-only path wrote database"); };
        c.state.registry.settings.set = async () => { writes.push("settings"); throw new Error("settings write"); };
        const auth = c.state.registry.llm.accountAuthHealth;
        c.state.registry.llm.accountAuthHealth = async (ctx: any, s: any, o: any) => {
            if (!["get", "list"].includes(o.action)) { writes.push("auth"); throw new Error("auth write"); }
            return auth(ctx, s, o);
        };
        expect((await c.fns.llm.claudePoolSelect({ preferredAccount: "work", readOnly: true })).account).toBe("work");
        await expect(c.fns.llm.claudePoolSelect({ failedAccount: "adam", readOnly: true })).rejects.toThrow("read-only");
        await expect(c.fns.llm.claudePoolSelect({ preferredAccount: "unknown", readOnly: true })).rejects.toThrow("missing");
        expect((await c.fns.agent.createFromValues({ model, claudeAccount: "work", projectId: "missing-project" })).error).toContain("unknown project");
        expect((await c.fns.agent.createFromValues({ model: "invalid:bad", claudeAccount: "work" })).error).toContain("Claude subscription model");
        expect((await c.fns.agent.createFromValues({ model, claudeAccount: "work", systemPromptName: "__custom", systemPromptCore: "" })).error).toContain("empty");
        expect(writes).toEqual([]);
        expect(await current()).toBe("adam");
    });

    test("start failure leaves the shared account unchanged; a successful start applies explicit choice afterwards", async () => {
        const start = c.state.registry.agent.start;
        c.state.registry.agent.start = async () => { expect(await current()).toBe("adam"); throw new Error("project start failed"); };
        expect((await c.fns.agent.createFromValues({ model, claudeAccount: "work" })).error).toBe("project start failed");
        expect(await current()).toBe("adam");
        c.state.registry.agent.start = async (ctx: any, s: any, o: any) => { expect(await current()).toBe("adam"); return start(ctx, s, o); };
        const result = await c.fns.agent.createFromValues({ model: "anthropic-oauth/adam:claude-fable-5-1", claudeAccount: "work" });
        expect(result.error).toBeUndefined();
        expect(result.agent.model).toBe(model);
        expect(await current()).toBe("work");
    });

    test("selection failure after creation reports the created id explicitly and never queues inference", async () => {
        const start = c.state.registry.agent.start;
        c.state.registry.agent.start = async (ctx: any, s: any, o: any) => {
            const created = await start(ctx, s, o);
            await c.fns.procs.db.run({ sql: "DELETE FROM oauth_credentials WHERE provider=? AND account=?", params: ["anthropic-oauth", "work"] });
            return created;
        };
        const result = await c.fns.agent.createFromValues({ model, claudeAccount: "work" });
        expect(result.error).toContain(`Agent ${result.agent.id} was created`);
        expect(result.error).toContain("No inference was scheduled");
        expect(await current()).toBe("adam");
        const row = (await c.fns.procs.db.select({ sql: "SELECT next_run_at FROM agents WHERE id=?", params: [result.agent.id] }))[0];
        expect(row.next_run_at).toBeNull();
    });

    test("picker distinguishes durable managed auth failure from refreshable expiry and CLI homonyms", async () => {
        c.state.registry.llm.listModels = async () => ({ "claude-code": [model] });
        c.state.registry.node.list = async () => [];
        c.state.registry.llm.listAccounts = async () => [
            { provider: "claude-code", account: "adam", available: true, needsReconnect: false, usedPercent: 99, planType: "wrong-cli" },
            { provider: "anthropic-oauth", account: "adam", available: false, needsReconnect: true, usedPercent: 5, planType: "managed" },
            { provider: "anthropic-oauth", account: "work", available: false, needsReconnect: true, usedPercent: 3 },
        ];
        await c.fns.llm.accountAuthHealth({ action: "mark", provider: "anthropic-oauth", account: "work" });
        await c.fns.llm.accountAuthHealth({ action: "mark", provider: "claude-code", account: "adam" });
        await c.fns.procs.db.run({ sql: "UPDATE oauth_credentials SET expires_at=? WHERE provider=? AND account=?", params: [Date.now() - 10, "anthropic-oauth", "adam"] });
        const html = await c.fns.agent.modelPickerHtml({ current: model, mode: "form" });
        const tagFor = (account: string) => html.match(new RegExp(`<[^>]*data-claude-account="${account}"[^>]*>`))?.[0] ?? "";
        expect(tagFor("adam")).not.toBe("");
        expect(tagFor("adam")).not.toContain('aria-disabled="true"');
        expect(tagFor("work")).toContain('aria-disabled="true"');
        expect(html).toContain("Reconnect");
        expect(html).toContain("95% left");
        expect(html).not.toContain("wrong-cli");
        expect(await current()).toBe("adam");
    });

    for (const redirected of [false, true]) test(`managed 429 goes through real refreshUsage with fixed origin, no redirects or secret diagnostics (redirect=${redirected})`, async () => {
        c.env.CLAUDE_CODE_BASE_API_URL = "https://arbitrary-host.invalid";
        c.env.CLAUDE_CODE_USER_AGENT = "test-agent";
        let inference = 0, usage = 0, profile = 0;
        let refreshResults: any[] = [];
        const realRefresh = c.state.registry.llm.refreshUsage;
        c.state.registry.llm.refreshUsage = async (ctx: any, s: any, o: any) => (refreshResults = await realRefresh(ctx, s, o));
        const logs: unknown[][] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => { logs.push(args); };
        c.state.registry.llm.connectFetch = async (_: any, __: any, o: any) => {
            expect(new URL(o.url).origin).toBe("https://api.anthropic.com");
            expect(o.init.redirect).toBe("error");
            expect(new Headers(o.init.headers).get("authorization")).toBe("Bearer test-token-adam");
            if (o.url === messagesUrl) { inference++; expect(o.init.body).toBe(body); return Response.json({ error: { type: "rate_limit_error", message: "ordinary throttle" } }, { status: 429 }); }
            expect(o.init.body).toBeUndefined();
            if (o.url.includes("/usage?")) {
                usage++;
                if (redirected) return new Response("private usage response marker", { status: 307, headers: { location: "https://arbitrary-host.invalid/steal" } });
                return Response.json({ five_hour: { utilization: 20, resets_at: new Date(Date.now() + 600_000).toISOString() } });
            }
            expect(o.url).toBe("https://api.anthropic.com/api/oauth/profile"); profile++;
            return Response.json({ organization: { organization_type: "claude_max" } });
        };
        try {
            const result = await request();
            expect(result).toMatchObject({ provider: "anthropic-oauth", account: "adam", pooled: true });
            expect(result.response.status).toBe(429);
            expect(inference).toBe(1); expect(usage).toBe(1); expect(profile).toBe(redirected ? 0 : 1);
            expect(refreshResults[0].status).toBe(redirected ? "failed" : "refreshed");
            const diagnostics = JSON.stringify({ logs, refreshResults });
            for (const secret of ["test-token-adam", "test-refresh-adam", "private prompt marker", "private usage response marker", "arbitrary-host.invalid"]) expect(diagnostics).not.toContain(secret);
            expect(await current()).toBe("adam");
            await result.response.body?.cancel();
        } finally { console.error = originalError; }
    });
});
