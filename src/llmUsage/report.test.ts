import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";
import schema from "./schema.entry";

let ctx: any, owner: any, member: any;
const from = Date.UTC(2026, 0, 1), to = from + 86_400_000;
const request = (role: string) => new Request("http://localhost/rpc/llmUsage.page", { headers: { "x-test-role": role } });
const as = (session: any) => { const c = Object.create(ctx); c.session = session; return c; };
beforeAll(async () => {
    ctx = await mkTestCtx();
    await schema.up(ctx);
    await ctx.fns.procs.db.exec({ sql: "DELETE FROM llm_usage_attempts; DELETE FROM llm_usage_calls;" });
    ctx.state.registry.auth.currentUser = async (_c: any, _s: any, { req }: any) => {
        const role = req.headers.get("x-test-role");
        return { user: role === "owner" || role === "member" || role === "disabled" ? { id: role, role: role === "disabled" ? "owner" : role, disabledAt: role === "disabled" ? 1 : null } : null, required: true };
    };
    const settingsGet = ctx.state.registry.settings.get;
    ctx.state.registry.settings.get = (c: any, s: any, o: any) => o.module === "llmUsage" && o.key === "enabled" ? true : settingsGet(c, s, o);
    owner = as({ kind: "http", req: request("owner"), user: { id: "owner", role: "owner" } });
    member = as({ kind: "http", req: request("member"), user: { id: "member", role: "member" } });
    const call = async (status: string, source = "node", start = from + 1000, remote = false) => {
        const id = crypto.randomUUID();
        await ctx.fns.procs.db.insert({ into: "llm_usage_calls", values: { id, status, source, operation: "call", agent_id: source === "local" ? "a1" : null, client_id: source === "node" ? "c1" : null, client_name: source === "node" ? '<script>alert("client")</script>' : null, started_at: start, remote } });
        return id;
    };
    const attempt = async (call_id: string, status: string, input: number | null, output: number | null, usage_state: string, account: string | null = "acc", remote = false) => {
        await ctx.fns.procs.db.insert({ into: "llm_usage_attempts", values: { id: crypto.randomUUID(), call_id, provider: "provider", model: "model", account, api: "openai", started_at: from + 1000, status, input_tokens: input, output_tokens: output, cache_read_tokens: input === null ? null : 3, cache_write_tokens: input === null ? null : 0, usage_state, remote } });
    };
    const a = await call("success");
    await attempt(a, "error", null, null, "unknown");
    await attempt(a, "success", 10, 5, "known");
    await attempt(a, "success", 900, 900, "known", "forwarded", true);
    const b = await call("error", "local");
    await attempt(b, "error", null, null, "unknown", null);
    const c = await call("cancelled");
    await attempt(c, "cancelled", 7, null, "partial");
    const d = await call("pending");
    await attempt(d, "pending", 100, 100, "partial");
    const remote = await call("success", "local", from + 1, true);
    await attempt(remote, "success", 1000, 1000, "known", "acc", true);
    const past = await call("success", "local", from - 1);
    await attempt(past, "success", 1000, 1000, "known");
    const end = await call("success", "local", to);
    await attempt(end, "success", 1000, 1000, "known");
});

afterAll(async () => {
    // This non-migrated fixture is not covered by the generic test reset.
    if (ctx) await ctx.fns.procs.db.exec({ sql: "DELETE FROM llm_usage_attempts; DELETE FROM llm_usage_calls;" });
});

describe("LLM accounting authorization", () => {
    test("only the actual active owner request authorizes; null, agent, missing, member and disabled deny", async () => {
        await expect(owner.fns.llmUsage.adminAccess({})).resolves.toBeUndefined();
        for (const session of [null, {}, { user: { id: "owner", role: "owner" } }, { req: request("owner"), agentId: "agent" }, { req: request("member"), user: { id: "owner", role: "owner" } }, { req: request("disabled") }, { req: request("anonymous") }]) {
            await expect(as(session).fns.llmUsage.report({ from, to })).rejects.toThrow("instance owner");
        }
    });
    test("rpc.render user override does not authorize the underlying read", async () => {
        const r = await member.fns.rpc.render({ fn: "llmUsage.page", params: { from, to }, user: { id: "owner", role: "owner" } });
        expect(r.status).not.toBe(200);
        expect(r.html).toContain("instance owner");
        expect(r.html).not.toContain("provider/acc");
    });
    test("GET view and POST JSON report both reject a real member request", async () => {
        const get = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost/rpc/llmUsage.page", headers: { "x-test-role": "member", "hx-request": "true" } });
        expect(get.status).not.toBe(200);
        expect(await get.text()).toContain("instance owner");
        const csrf = ctx.state.registry.auth.verifyCsrf;
        ctx.state.registry.auth.verifyCsrf = async () => true;
        try {
            const post = await ctx.fns.procs.http.dispatch({ method: "POST", url: "http://localhost/rpc", headers: { "x-test-role": "member" }, body: { method: "llmUsage.report", params: { from, to } } });
            expect(post.status).not.toBe(200);
            expect(await post.text()).toContain("instance owner");
        } finally { ctx.state.registry.auth.verifyCsrf = csrf; }
        const page = await owner.fns.rpc.render({ fn: "llmUsage.page", params: { from, to } });
        expect(page.status).toBe(200);
        expect(page.html).toContain("Учёт LLM");
    });
    test("unauthorized page never calls report SQL", async () => {
        const select = ctx.state.registry.procs.db.select;
        let calls = 0;
        ctx.state.registry.procs.db.select = () => { calls++; throw new Error("should not read"); };
        try { await expect(member.fns.llmUsage.page({ from, to })).rejects.toThrow("instance owner"); expect(calls).toBe(0); }
        finally { ctx.state.registry.procs.db.select = select; }
    });
});

describe("accounting aggregation", () => {
    test("counts distinct calls, completed tokens and unknown coverage without forwarded or pending tokens", async () => {
        const r = await owner.fns.llmUsage.report({ from, to, limit: 1 });
        expect(r.available).toBe(true);
        expect(r.totals).toEqual({ calls: 4, remoteCalls: 1, success: 1, errors: 1, cancelled: 1, pending: 1, attempts: 5, completedAttempts: 4, extraAttempts: 1, inputTokens: 17, outputTokens: 5, cacheReadTokens: 6, cacheWriteTokens: 0, known: 1, partial: 1, unknown: 2 });
        expect(r.trend.length).toBe(24);
        expect(r.trend.reduce((n: number, p: any) => n + p.calls, 0)).toBe(4);
        expect(r.trend.reduce((n: number, p: any) => n + p.attempts, 0)).toBe(5);
        expect(r.groups).toHaveLength(1);
        expect(r.groups[0].calls).toBe(4);
    });
    test("client/account/model/provider/source filters compose, null means unknown not zero", async () => {
        const r = await owner.fns.llmUsage.report({ from, to, clientId: "c1", account: "acc", provider: "provider", model: "model", source: "node", groupBy: "account" });
        expect(r.totals.calls).toBe(3);
        expect(r.totals.attempts).toBe(4);
        expect(r.totals.inputTokens).toBe(17);
        expect(r.groups[0].label).toBe("provider/acc");
        expect((await owner.fns.llmUsage.report({ from, to, agentId: "a1" })).totals.calls).toBe(1);
        expect((await owner.fns.llmUsage.report({ from, to, agentId: null })).totals.calls).toBe(3);
        const unknown = await owner.fns.llmUsage.report({ from, to, account: null, clientId: null });
        expect(unknown.totals.calls).toBe(1);
        expect(unknown.totals.unknown).toBe(1);
        expect(unknown.totals.inputTokens).toBeNull();
        const missing = await owner.fns.llmUsage.report({ from, to, provider: "' OR 1=1 --" });
        expect(missing.totals.calls).toBe(0);
        expect(missing.totals.inputTokens).toBeNull();
    });
    test("mixed remote-to-local fallback preserves direct spend but never adds forwarded tokens", async () => {
        const id = crypto.randomUUID(), at = to + 1000;
        await ctx.fns.procs.db.insert({ into: "llm_usage_calls", values: { id, source: "local", operation: "call", status: "success", remote: true, started_at: at } });
        for (const remote of [true, false]) await ctx.fns.procs.db.insert({ into: "llm_usage_attempts", values: { id: crypto.randomUUID(), call_id: id, provider: remote ? "hyper" : "direct", model: "model", account: "acc", api: "openai", remote, status: "success", started_at: at, input_tokens: remote ? 999 : 11, output_tokens: remote ? 999 : 4, usage_state: "known" } });
        const r = await owner.fns.llmUsage.report({ from: to, to: to + 2000, provider: "direct" });
        expect(r.totals.calls).toBe(1);
        expect(r.totals.remoteCalls).toBe(1);
        expect(r.totals.attempts).toBe(1);
        expect(r.totals.inputTokens).toBe(11);
        expect(r.totals.outputTokens).toBe(4);
    });
    test("period/group/limit values are bounded, UTC explicit, and malicious filters are parameters", async () => {
        for (const args of [{ from: to, to: from }, { from, to: from + 367 * 86400000 }, { from: "2026-01-01T12:00:00", to }, { from, to, groupBy: "sql" }, { from, to, limit: 101 }, { from, to, source: "other" }]) await expect(owner.fns.llmUsage.report(args)).rejects.toThrow();
        expect((await owner.fns.llmUsage.report({ from: "2026-01-01", to: "2026-01-02" })).totals.calls).toBe(4);
    });
    test("disabled and unmigrated empty states perform no ledger scan", async () => {
        const get = ctx.state.registry.settings.get, select = ctx.state.registry.procs.db.select;
        let queries = 0;
        ctx.state.registry.procs.db.select = (_c: any, _s: any, o: any) => { queries++; expect(o.sql).toContain("to_regclass"); return [{ ready: false }]; };
        try {
            ctx.state.registry.settings.get = () => false;
            expect((await owner.fns.llmUsage.report({ from, to })).reason).toBe("disabled");
            expect(queries).toBe(0);
            ctx.state.registry.settings.get = () => true;
            expect((await owner.fns.llmUsage.report({ from, to })).reason).toBe("not-migrated");
            expect(queries).toBe(1);
        } finally { ctx.state.registry.settings.get = get; ctx.state.registry.procs.db.select = select; }
    });
    test("enabled GET form serializes empty filters and string values into a replaceable htmx fragment", async () => {
        const initial = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost/rpc/llmUsage.page?" + new URLSearchParams({ from: String(from), to: String(to), source: "", clientId: "", agentId: "", provider: "", account: "", model: "", groupBy: "agent", limit: "10" }), headers: { "x-test-role": "owner", "hx-request": "true" } });
        expect(initial.status).toBe(200);
        const html = await initial.text();
        expect(html).toContain('<section data-llm-usage>');
        expect(html).toContain('hx-target="closest [data-llm-usage]"');
        expect(html).toContain('hx-select="[data-llm-usage]"');
        expect(html).toContain('hx-swap="outerHTML"');
        expect(html).toContain('value="agent" selected');
        expect(html).toContain("a1");
        const fields = new URLSearchParams();
        for (const m of html.matchAll(/<input name="([^"]+)" value="([^"]*)"/g)) fields.set(m[1]!, m[2]!);
        fields.set("source", ""); fields.set("groupBy", "agent"); fields.set("agentId", "a1");
        const filtered = await ctx.fns.procs.http.dispatch({ method: "GET", url: "http://localhost/rpc/llmUsage.page?" + fields, headers: { "x-test-role": "owner", "hx-request": "true" } });
        expect(filtered.status).toBe(200);
        const filteredHtml = await filtered.text();
        expect(filteredHtml).toContain('<section data-llm-usage>');
        expect(filteredHtml).toContain('name="agentId" value="a1"');
        expect(filteredHtml).toContain('value="agent" selected');
        expect(filteredHtml).not.toContain("Хранилище учёта не подготовлено");
        const grouped = await owner.fns.llmUsage.report({ from, to, groupBy: "agent" });
        expect(grouped.groups.find((g: any) => g.key === "a1").calls).toBe(1);
        expect(grouped.groups.find((g: any) => g.key === "").calls).toBe(3);
    });
    test("Canvas page is discoverable, escaped, filterable, includes totals/trend and no raw content", async () => {
        expect(ctx.fns.runtime.docs.get({ name: "llmUsage.page" }).view).toBe(true);
        const html = await owner.fns.llmUsage.page({ from, to, groupBy: "client" });
        expect(html).toContain("Учёт LLM");
        expect(html).toContain('name="clientId"');
        expect(html).toContain('role="img"');
        expect(html).toContain("Вызовы по времени");
        expect(html).not.toContain('<script>alert("client")</script>');
        expect(html).toContain("&lt;script&gt;");
    });
});
