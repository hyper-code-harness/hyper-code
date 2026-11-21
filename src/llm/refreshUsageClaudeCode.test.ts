import { describe, expect, test } from "bun:test";
import refreshUsage from "./refreshUsage";
import parseClaudeResetCredits from "./parseClaudeResetCredits";

// Mocked procedure registry: never accesses real credentials, Postgres or HTTP.
function mkTestCtx() {
    const ctx: any = { env: {}, fns: { procs: { db: { select: async () => [], run: async () => ({ changes: 0 }) } }, llm: {
        claudeCodeCliVersion: async () => "test",
        accountAuthHealth: async () => [],
        recordUsage: async () => ({}),
        getAnthropicOAuthToken: async () => "managed-token",
    } } };
    ctx.fns.llm.parseClaudeResetCredits = (opts: Parameters<typeof parseClaudeResetCredits>[2]) => parseClaudeResetCredits(ctx, null, opts);
    ctx.fns.llm.refreshUsage = (opts: Parameters<typeof refreshUsage>[2]) => refreshUsage(ctx, null, opts);
    return ctx;
}
const run = (ctx: any, provider = "claude-code") => ctx.fns.llm.refreshUsage({ accounts: [{ provider, account: "work" }], maxAgeMs: 0 });
const usage = () => Response.json({ five_hour: { utilization: 12, resets_at: "2030-01-01T00:00:00Z" } });
const profile = () => Response.json({ organization: { organization_type: "claude_max" } });
function failed(onCancel: () => void, status = 401) {
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("failed")); }, cancel: onCancel }), { status });
}

test("managed Claude reset reads use the fixed origin, CLI beta, and reject redirects", async () => {
    const ctx = mkTestCtx();
    ctx.env.CLAUDE_CODE_BASE_API_URL = "https://not-anthropic.invalid";
    const sent: string[] = [];
    let recorded: any;
    ctx.fns.llm.recordUsage = async (opts: any) => { recorded = opts; return {}; };
    ctx.fns.llm.connectFetch = async (opts: any) => {
        sent.push(opts.url);
        expect(opts.url.startsWith("https://api.anthropic.com/api/oauth/")).toBe(true);
        expect(opts.init.redirect).toBe("error");
        expect(opts.init.method).toBe("GET");
        expect(opts.init.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
        expect(opts.init.headers["user-agent"]).toBe("claude-cli/test (external, cli)");
        return opts.url.endsWith("profile") ? profile() : Response.json({ five_hour: { utilization: 12 }, cedar_ember: { eligible: false, ineligible_reason: "surface", grants: [] } });
    };
    expect((await run(ctx, "anthropic-oauth"))[0].status).toBe("refreshed");
    expect(sent).toEqual(["https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1", "https://api.anthropic.com/api/oauth/profile"]);
    expect(recorded.resetCredits).toMatchObject({ availableCount: null, unavailableReason: "surface" });
});

test("a thrown rejected-token refresh closes the failed response without replay", async () => {
    const ctx = mkTestCtx();
    let cancelled = false, calls = 0;
    ctx.fns.llm.refreshClaudeCode = async (opts: any) => { if (opts.rejectedToken) throw new Error("mock refresh failed"); return "old-token"; };
    ctx.fns.llm.connectFetch = async () => { calls++; return failed(() => { cancelled = true; }); };
    expect((await run(ctx))[0].status).toBe("failed");
    expect(cancelled).toBe(true);
    expect(calls).toBe(1);
});

describe("refreshUsage Claude Code recovery", () => {
    test("retries usage with a new bearer once, then uses it for profile", async () => {
        const ctx = mkTestCtx();
        const refreshes: any[] = [], sent: any[] = [];
        let cancelled = false;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => { refreshes.push(opts); return opts.rejectedToken ? "new-token" : "old-token"; };
        ctx.fns.llm.connectFetch = async (opts: any) => {
            sent.push(opts);
            if (sent.length === 1) return failed(() => { cancelled = true; });
            expect(cancelled).toBe(true);
            expect(opts.init.headers.authorization).toBe("Bearer new-token");
            return opts.url.endsWith("profile") ? profile() : usage();
        };
        expect((await run(ctx))[0].status).toBe("refreshed");
        expect(refreshes).toEqual([{ account: "work" }, { account: "work", rejectedToken: "old-token" }]);
        expect(sent).toHaveLength(3);
        expect(sent[0].init.headers.authorization).toBe("Bearer old-token");
        expect(sent[0].ms).toBe(5000);
    });

    for (const replacement of [null, "old-token"]) test(`no request replay with replacement ${replacement}`, async () => {
        const ctx = mkTestCtx();
        let cancelled = false, calls = 0;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => opts.rejectedToken ? replacement : "old-token";
        ctx.fns.llm.connectFetch = async () => { calls++; return failed(() => { cancelled = true; }); };
        expect((await run(ctx))[0]).toMatchObject({ status: "failed", error: "usage endpoint returned 401" });
        expect(calls).toBe(1);
        expect(cancelled).toBe(true);
    });

    test("second usage 401 stops after one retry and cancels both discarded responses", async () => {
        const ctx = mkTestCtx();
        let calls = 0, cancelled = 0, refreshes = 0;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => { refreshes++; return opts.rejectedToken ? "new-token" : "old-token"; };
        ctx.fns.llm.connectFetch = async () => { calls++; return failed(() => { cancelled++; }); };
        expect((await run(ctx))[0].status).toBe("failed");
        expect(calls).toBe(2);
        expect(refreshes).toBe(2);
        expect(cancelled).toBe(2);
    });

    test("profile 401 can recover once without discarding successful quota", async () => {
        const ctx = mkTestCtx();
        let calls = 0, cancelled = false;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => opts.rejectedToken ? "new-token" : "old-token";
        ctx.fns.llm.connectFetch = async (opts: any) => {
            calls++;
            if (new URL(opts.url).pathname.endsWith("usage")) return usage();
            if (calls === 2) return failed(() => { cancelled = true; });
            expect(cancelled).toBe(true);
            expect(opts.init.headers.authorization).toBe("Bearer new-token");
            return profile();
        };
        expect((await run(ctx))[0].status).toBe("refreshed");
        expect(calls).toBe(3);
    });

    test("usage and profile share a single 401 recovery budget", async () => {
        const ctx = mkTestCtx();
        let calls = 0, refreshes = 0, cancelled = 0;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => { refreshes++; return opts.rejectedToken ? "new-token" : "old-token"; };
        ctx.fns.llm.connectFetch = async () => { calls++; return calls === 2 ? usage() : failed(() => { cancelled++; }); };
        expect((await run(ctx))[0].status).toBe("refreshed");
        expect(calls).toBe(3);
        expect(refreshes).toBe(2);
        expect(cancelled).toBe(2);
    });

    for (const mode of ["403", "network", "success"]) test(`${mode} never triggers forced credential recovery`, async () => {
        const ctx = mkTestCtx();
        let refreshes = 0, calls = 0;
        ctx.fns.llm.refreshClaudeCode = async (opts: any) => { refreshes++; expect(opts.rejectedToken).toBeUndefined(); return "old-token"; };
        ctx.fns.llm.connectFetch = async (opts: any) => {
            calls++;
            if (mode === "network") throw new Error("offline");
            if (mode === "403") return new Response("forbidden", { status: 403 });
            return new URL(opts.url).pathname.endsWith("usage") ? usage() : profile();
        };
        expect((await run(ctx))[0].status).toBe(mode === "success" ? "refreshed" : "failed");
        expect(refreshes).toBe(1);
        expect(calls).toBe(mode === "success" ? 2 : 1);
    });

    test("managed OAuth usage 401 never refreshes a CLI token or retries", async () => {
        const ctx = mkTestCtx();
        let calls = 0;
        ctx.fns.llm.refreshClaudeCode = async () => { throw new Error("CLI credential must not be read"); };
        ctx.fns.llm.connectFetch = async (opts: any) => { calls++; expect(opts.init.headers.authorization).toBe("Bearer managed-token"); return new Response("unauthorized", { status: 401 }); };
        expect((await run(ctx, "anthropic-oauth"))[0].status).toBe("failed");
        expect(calls).toBe(1);
    });
});
