import { describe, expect, test } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

// Every request and credential lookup is replaced in this context's registry.
// Only the disposable mkTestCtx Postgres database is real: ticket claims, org
// locks, and xmin/ctid compare-and-swap must exercise actual atomic SQL.
type Provider = "claude-code" | "anthropic-oauth";
type HttpCall = { url: string; ms: number; init: RequestInit };
type Account = { provider: Provider; account: string };
const ORGANIZATION = "12345678-1234-4234-8234-123456789abc";
const OTHER_ORGANIZATION = "87654321-4321-4321-8321-cba987654321";
const SECRET = "fixture-only-bearer-never-read-real-credentials";
const PRIVATE_ERROR = `upstream error: ${SECRET}; private-account@example.invalid`;

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

async function fixture(provider: Provider = "claude-code", account = "reset-safety-test") {
    const ctx = await mkTestCtx();
    ctx.env.CLAUDE_CODE_BASE_API_URL = "https://untrusted-override.invalid";
    const registry = ctx.state.registry;
    const realStatus = registry.llm.claudeResetStatus;
    const realRefresh = registry.llm.refreshUsage;
    const calls: HttpCall[] = [];
    const statusCalls: Account[] = [];
    const credentials: Array<{ provider: Provider; account: string }> = [];
    const refreshes: Array<{ provider: string; account: string; maxAgeMs: number; preserveOnFailure: boolean }> = [];
    const notifications: string[] = [];
    const now = Date.now();
    const state: types.llm.ClaudeResetState = {
        organizationId: ORGANIZATION,
        nextGrantId: "weekly_reset",
        cooldownUntil: null,
        resetCredits: {
            availableCount: 2,
            checkedAt: now,
            credits: [{ id: "weekly_reset", title: "Weekly reset", description: "five_hour, seven_day", remainingCount: 2, usableNow: true, grantedAt: now - 60_000, expiresAt: now + 3_600_000 }],
        },
    };
    let getStatus = async () => structuredClone(state);
    let getProfile = async () => Response.json({ organization: { uuid: state.organizationId } });
    let getUsage = async () => Response.json({ cedar_ember: {
        eligible: true,
        next_grant_id: state.nextGrantId,
        cooldown_until: state.cooldownUntil == null ? null : new Date(state.cooldownUntil).toISOString(),
        grants: state.resetCredits.credits!.map(c => ({
            id: c.id, label: c.title, clears: c.description?.split(", "), resets_left: c.remainingCount,
            resets_total: 2, usable_now: c.usableNow,
            starts_at: new Date(Number(c.grantedAt)).toISOString(), ends_at: new Date(Number(c.expiresAt)).toISOString(),
        })),
    } });
    let post = async (_call: HttpCall) => Response.json({ result: "reset" });
    let refresh = async () => [{ provider, account, status: "refreshed" }];
    registry.llm.refreshClaudeCode = async (_c: Context, _s: Session | null, opts: { account: string }) => {
        credentials.push({ provider: "claude-code", account: opts.account });
        return SECRET;
    };
    registry.llm.getAnthropicOAuthToken = async (_c: Context, _s: Session | null, opts: { account: string }) => {
        credentials.push({ provider: "anthropic-oauth", account: opts.account });
        return SECRET;
    };
    registry.llm.claudeCodeCliVersion = async () => "reset-test";
    registry.llm.listAccounts = async () => [{ provider, account }];
    registry.llm.accountAuthHealth = async () => [];
    registry.ui.notify = async () => undefined;
    registry.llm.claudeResetStatus = async (_c: Context, _s: Session | null, opts: Account) => {
        statusCalls.push(opts);
        return await getStatus();
    };
    registry.llm.connectFetch = async (_c: Context, _s: Session | null, call: HttpCall) => {
        calls.push(call);
        if (call.init.method === "POST") return await post(call);
        if (call.url.endsWith("/api/oauth/profile")) return await getProfile();
        if (call.url.endsWith("/api/oauth/usage?cedar_ember=1&skip_spend=1")) return await getUsage();
        throw new Error("Unexpected mocked request; real HTTP is forbidden");
    };
    registry.llm.refreshUsage = async (_c: Context, _s: Session | null, opts: typeof refreshes[number]) => {
        refreshes.push(opts);
        return await refresh();
    };
    registry.procs.events.refresh = (_c: Context, _s: Session | null, opts: { topic: string }) => { notifications.push(opts.topic); };
    return {
        ctx, state, calls, statusCalls, credentials, refreshes, notifications, provider, account,
        credit: state.resetCredits.credits![0]!,
        usageKey: `llm:usage:${provider}:${account}`,
        prepare: () => ctx.fns.llm.prepareClaudeReset({ provider, account }) as Promise<types.llm.ClaudeResetAttempt>,
        consume: (ticketId: string, confirmed = true) => ctx.fns.llm.consumeClaudeReset({ ticketId, confirmed }) as Promise<types.llm.ClaudeResetAttempt>,
        posts: () => calls.filter(c => c.init.method === "POST"),
        realStatus: () => { registry.llm.claudeResetStatus = realStatus; },
        realRefresh: () => {
            registry.llm.refreshUsage = async (c: Context, s: Session | null, opts: typeof refreshes[number]) => {
                refreshes.push(opts);
                return await realRefresh(c, s, opts);
            };
        },
        setStatus: (fn: typeof getStatus) => { getStatus = fn; },
        setProfile: (fn: typeof getProfile) => { getProfile = fn; },
        setUsage: (fn: typeof getUsage) => { getUsage = fn; },
        setPost: (fn: typeof post) => { post = fn; },
        setRefresh: (fn: typeof refresh) => { refresh = fn; },
    };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function value(f: Fixture, key: string): Promise<string | undefined> {
    return (await f.ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key=?", params: [key] }))[0]?.value;
}
async function savedAttempt(f: Fixture, id: string): Promise<types.llm.ClaudeResetAttempt> {
    return JSON.parse((await value(f, "llm:claude-reset:attempt:" + id))!);
}
async function quotaFailure(f: Fixture): Promise<string> {
    await f.ctx.fns.llm.recordUsage({ provider: f.provider, account: f.account, spent: true, resetsAt: Date.now() + 60_000 });
    return (await value(f, f.usageKey))!;
}

function assertSafeResult(result: unknown) {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("private-account@example.invalid");
}

describe("Claude reset confirmation and pinned eligibility", () => {
    test("prepare is read-only, credential-free, and records the exact five-minute finite-cost confirmation", async () => {
        const f = await fixture();
        const startedAt = Date.now();
        const ticket = await f.prepare();
        expect(f.posts()).toHaveLength(0);
        expect(f.calls).toHaveLength(0);
        expect(f.credentials).toHaveLength(0);
        expect(f.statusCalls).toEqual([{ provider: f.provider, account: f.account }]);
        expect(ticket).toMatchObject({ provider: f.provider, account: f.account, organizationId: ORGANIZATION,
            grantId: "weekly_reset", grantTitle: "Weekly reset", clears: "five_hour, seven_day", remainingCount: 2,
            grantExpiresAt: f.credit.expiresAt, state: "prepared" });
        expect(ticket.createdAt).toBeGreaterThanOrEqual(startedAt);
        expect(ticket.expiresAt).toBe(ticket.createdAt + 300_000);
        expect(await savedAttempt(f, ticket.id)).toEqual(ticket);
        assertSafeResult(ticket);
    });

    test("the confirmation cannot outlive its grant", async () => {
        const f = await fixture();
        f.credit.expiresAt = Date.now() + 60_000;
        expect((await f.prepare()).expiresAt).toBe(f.credit.expiresAt);
    });

    const unavailable: Array<[string, (f: Fixture) => void]> = [
        ["unknown availability", f => { f.state.resetCredits.availableCount = null; }],
        ["no next grant", f => { f.state.nextGrantId = null; }],
        ["unusable grant", f => { f.credit.usableNow = false; }],
        ["spent grant", f => { f.credit.remainingCount = 0; }],
        ["expired grant", f => { f.credit.expiresAt = Date.now() - 1; }],
        ["cooldown", f => { f.state.cooldownUntil = Date.now() + 60_000; }],
    ];
    for (const [label, mutate] of unavailable) test(`prepare refuses ${label} without a ticket or POST`, async () => {
        const f = await fixture(); mutate(f);
        await expect(f.prepare()).rejects.toThrow("No Claude reset is usable");
        expect(f.posts()).toHaveLength(0);
        expect(await f.ctx.fns.procs.db.select({ sql: "SELECT key FROM kv WHERE key LIKE ?", params: ["llm:claude-reset:attempt:%"] })).toEqual([]);
    });

    test("confirmed:false cannot claim a ticket, fetch credentials, or send any request", async () => {
        const f = await fixture(); const ticket = await f.prepare();
        await expect(f.consume(ticket.id, false)).rejects.toThrow("Explicit confirmation");
        expect(await savedAttempt(f, ticket.id)).toEqual(ticket);
        expect(f.statusCalls).toHaveLength(1);
        expect(f.credentials).toHaveLength(0);
        expect(f.calls).toHaveLength(0);
    });

    test("an expired ticket cannot be claimed or POSTed", async () => {
        const f = await fixture(); const ticket = await f.prepare();
        ticket.expiresAt = Date.now() - 1;
        await f.ctx.fns.procs.db.run({ sql: "UPDATE kv SET value=? WHERE key=?", params: [JSON.stringify(ticket), "llm:claude-reset:attempt:" + ticket.id] });
        await expect(f.consume(ticket.id)).rejects.toThrow("expired");
        expect(f.statusCalls).toHaveLength(1);
        expect(f.calls).toHaveLength(0);
        expect(await savedAttempt(f, ticket.id)).toEqual(ticket);
    });

    const changed: Array<[string, (f: Fixture) => void]> = [
        ["organization", f => { f.state.organizationId = OTHER_ORGANIZATION; }],
        ["provider-selected grant", f => { f.state.nextGrantId = "other_reset"; }],
        ["remaining count", f => { f.credit.remainingCount = 1; }],
        ["grant expiry", f => { f.credit.expiresAt = Number(f.credit.expiresAt) + 1000; }],
        ["cleared quota scope", f => { f.credit.description = "five_hour"; }],
        ["grant usability", f => { f.credit.usableNow = false; }],
        ["cooldown", f => { f.state.cooldownUntil = Date.now() + 60_000; }],
        ["missing grant", f => { f.state.resetCredits.credits = []; }],
    ];
    for (const [label, mutate] of changed) test(`a changed ${label} invalidates confirmation without POST`, async () => {
        const f = await fixture(); const ticket = await f.prepare(); mutate(f);
        const result = await f.consume(ticket.id);
        expect(result.outcome).toBe("changed");
        expect(f.posts()).toHaveLength(0);
        expect(await savedAttempt(f, ticket.id)).toEqual(result);
        expect(await value(f, "llm:claude-reset:org:" + ORGANIZATION)).toBeUndefined();
    });

    test("the final bearer profile must still belong to the confirmed organization", async () => {
        const f = await fixture(); const ticket = await f.prepare();
        f.setProfile(async () => Response.json({ organization: { uuid: OTHER_ORGANIZATION } }));
        expect((await f.consume(ticket.id)).outcome).toBe("changed");
        expect(f.posts()).toHaveLength(0);
        expect(f.calls).toHaveLength(1);
    });

    for (const provider of ["claude-code", "anthropic-oauth"] as const) test(`${provider}: confirmation revalidates the exact nondefault account and never falls back`, async () => {
        const f = await fixture(provider, "explicit-secondary-slot"); const ticket = await f.prepare();
        expect((await f.consume(ticket.id)).outcome).toBe("reset");
        expect(f.statusCalls).toEqual([{ provider, account: f.account }, { provider, account: f.account }]);
        expect(f.credentials).toEqual([{ provider, account: f.account }]);
        expect(f.refreshes).toEqual([{ provider, account: f.account, maxAgeMs: 0, preserveOnFailure: true }]);
    });
});

describe("Claude reset atomic one-use claims and organization locks", () => {
    test("simultaneous and later duplicate submissions of one ticket send exactly one POST", async () => {
        const f = await fixture(); const ticket = await f.prepare();
        const entered = deferred(), release = deferred();
        f.setPost(async () => { entered.resolve(); await release.promise; return Response.json({ result: "reset" }); });
        const first = f.consume(ticket.id);
        await entered.promise;
        let duplicates: types.llm.ClaudeResetAttempt[];
        try { duplicates = await Promise.all(Array.from({ length: 8 }, () => f.consume(ticket.id))); }
        finally { release.resolve(); }
        const completed = await first;
        expect(duplicates!.every(a => a.state === "sending")).toBe(true);
        expect(completed.outcome).toBe("reset");
        expect(await f.consume(ticket.id)).toEqual(completed);
        expect(f.posts()).toHaveLength(1);
        expect(f.statusCalls).toHaveLength(2);
    });

    test("different concurrent tickets for one organization permit at most one POST", async () => {
        const f = await fixture();
        const tickets = await Promise.all(Array.from({ length: 8 }, () => f.prepare()));
        const entered = deferred(), release = deferred();
        f.setPost(async () => { entered.resolve(); await release.promise; return Response.json({ result: "reset" }); });
        const first = f.consume(tickets[0]!.id);
        await entered.promise;
        let others: types.llm.ClaudeResetAttempt[];
        try { others = await Promise.all(tickets.slice(1).map(t => f.consume(t.id))); }
        finally { release.resolve(); }
        expect((await first).outcome).toBe("reset");
        expect(others!.map(a => a.outcome)).toEqual(Array(7).fill("busy"));
        expect(f.posts()).toHaveLength(1);
        for (const ticket of tickets.slice(1)) expect((await f.consume(ticket.id)).outcome).toBe("busy");
        expect(f.posts()).toHaveLength(1);
    });

    const ambiguous: Array<[string, () => Promise<Response>]> = [
        ["transport failure", async () => { throw new Error(PRIVATE_ERROR); }],
        ["timeout", async () => { throw new DOMException(PRIVATE_ERROR, "TimeoutError"); }],
        ["non-2xx response", async () => new Response(PRIVATE_ERROR, { status: 503 })],
        ["malformed JSON", async () => new Response("not-json " + PRIVATE_ERROR)],
        ["unrecognized result", async () => Response.json({ result: "probably_reset", debug: PRIVATE_ERROR })],
        ["missing result", async () => Response.json({ debug: PRIVATE_ERROR })],
    ];
    for (const [label, respond] of ambiguous) test(`${label}: no retry and ten-minute organization lock`, async () => {
        const f = await fixture(); const ticket = await f.prepare();
        const oldQuota = await quotaFailure(f);
        f.setPost(respond);
        const startedAt = Date.now();
        const result = await f.consume(ticket.id);
        expect(result).toMatchObject({ state: "done", outcome: "uncertain" });
        const lock = JSON.parse((await value(f, "llm:claude-reset:org:" + ORGANIZATION))!);
        expect(lock.id).toBe(ticket.id);
        expect(lock.expiresAt).toBeGreaterThanOrEqual(startedAt + 600_000);
        expect(lock.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
        expect(await f.consume(ticket.id)).toEqual(result);
        const second = await f.prepare();
        expect((await f.consume(second.id)).outcome).toBe("busy");
        expect(f.posts()).toHaveLength(1);
        expect(await value(f, f.usageKey)).toBe(oldQuota);
        expect(JSON.parse((await value(f, "llm:claude-reset:org:" + ORGANIZATION))!)).toEqual(lock);
        assertSafeResult(result);
        assertSafeResult(await savedAttempt(f, ticket.id));
    });
});

describe("Claude reset provider outcomes and cache reconciliation", () => {
    for (const outcome of ["reset", "already_used", "not_limited", "cooldown", "ineligible", "unavailable"] as const) test(`${outcome} remains distinct and only reset clears preexisting quota failure`, async () => {
        const f = await fixture(); const ticket = await f.prepare(); const prior = await quotaFailure(f);
        f.notifications.length = 0; // Ignore the setup recordUsage notification.
        f.setPost(async () => Response.json({ result: outcome }));
        const result = await f.consume(ticket.id);
        expect(result).toMatchObject({ outcome, state: "done", usageRefreshed: true });
        expect(await value(f, f.usageKey)).toBe(outcome === "reset" ? undefined : prior);
        expect(await value(f, "llm:claude-reset:org:" + ORGANIZATION)).toBeUndefined();
        expect(await savedAttempt(f, ticket.id)).toEqual(result);
        expect(f.notifications).toEqual(["llm-usage", "llm-accounts"]);
        expect(await f.consume(ticket.id)).toEqual(result);
        expect(f.posts()).toHaveLength(1);
    });

    for (const thrown of [false, true]) test(`a ${thrown ? "thrown" : "reported"} usage refresh failure never becomes reset failure or permits replay`, async () => {
        const f = await fixture(); const ticket = await f.prepare();
        f.setRefresh(async () => {
            if (thrown) throw new Error(PRIVATE_ERROR);
            return [{ provider: f.provider, account: f.account, status: "failed" }];
        });
        const result = await f.consume(ticket.id);
        expect(result).toMatchObject({ outcome: "reset", state: "done", usageRefreshed: false });
        expect((await f.consume(ticket.id)).outcome).toBe("reset");
        expect(f.posts()).toHaveLength(1);
        expect(f.refreshes).toHaveLength(1);
        assertSafeResult(result);
    });

    for (const identical of [false, true]) test(`CAS preserves a concurrent ${identical ? "byte-identical" : "changed"} quota failure write`, async () => {
        const f = await fixture(); const ticket = await f.prepare(); const oldQuota = await quotaFailure(f);
        const nextQuota = identical ? oldQuota : JSON.stringify({ ...JSON.parse(oldQuota), updatedAt: Date.now() + 50_000 });
        const rowVersion = async () => (await f.ctx.fns.procs.db.select({ sql: "SELECT xmin::text AS version,ctid::text AS tuple FROM kv WHERE key=?", params: [f.usageKey] }))[0];
        const before = await rowVersion();
        f.setPost(async () => {
            // A different DB statement commits while the provider reset is in flight.
            await f.ctx.fns.procs.db.run({ sql: "UPDATE kv SET value=? WHERE key=?", params: [nextQuota, f.usageKey] });
            return Response.json({ result: "reset" });
        });
        f.setRefresh(async () => [{ provider: f.provider, account: f.account, status: "failed" }]);
        expect((await f.consume(ticket.id)).outcome).toBe("reset");
        expect(await value(f, f.usageKey)).toBe(nextQuota);
        expect(await rowVersion()).not.toEqual(before);
        expect(f.refreshes[0]!.preserveOnFailure).toBe(true);
        expect(f.posts()).toHaveLength(1);
    });

    test("a failure first written while POST is in flight is not cleared", async () => {
        const f = await fixture(); const ticket = await f.prepare(); let concurrent!: string;
        f.setPost(async () => { concurrent = await quotaFailure(f); return Response.json({ result: "reset" }); });
        expect((await f.consume(ticket.id)).outcome).toBe("reset");
        expect(await value(f, f.usageKey)).toBe(concurrent);
    });

    for (const refreshFails of [false, true]) test(`real refreshUsage ${refreshFails ? "failure" : "success"} preserves a failure written during the reset POST`, async () => {
        const f = await fixture("anthropic-oauth"); const ticket = await f.prepare(); await quotaFailure(f);
        f.realRefresh();
        let concurrent!: types.llm.UsageSnapshot;
        f.setPost(async () => {
            await f.ctx.fns.llm.recordUsage({ provider: f.provider, account: f.account, spent: true, resetsAt: Date.now() + 600_000, now: Date.now() + 1 });
            concurrent = JSON.parse((await value(f, f.usageKey))!);
            return Response.json({ result: "reset" });
        });
        f.setUsage(async () => {
            if (refreshFails) return new Response(PRIVATE_ERROR, { status: 503 });
            return Response.json({ five_hour: { utilization: 1, resets_at: new Date(Date.now() + 600_000).toISOString() }, cedar_ember: { eligible: true, grants: [] } });
        });
        const result = await f.consume(ticket.id);
        expect(result).toMatchObject({ outcome: "reset", usageRefreshed: !refreshFails });
        const after = JSON.parse((await value(f, f.usageKey))!) as types.llm.UsageSnapshot;
        expect(after.windows).toEqual(concurrent.windows);
        expect(after.source).toBe("error");
        expect(after.updatedAt).toBe(concurrent.updatedAt);
        expect(f.posts()).toHaveLength(1);
        expect(f.refreshes[0]!.preserveOnFailure).toBe(true);
        assertSafeResult(result);
    });
});

describe("Claude reset authenticated reads, error sanitization, and wire contract", () => {
    for (const provider of ["claude-code", "anthropic-oauth"] as const) test(`${provider}: real status uses only official GET endpoints and consume uses the fixed POST contract`, async () => {
        const f = await fixture(provider); f.realStatus();
        const ticket = await f.prepare();
        expect(f.calls.map(c => c.url)).toEqual([
            "https://api.anthropic.com/api/oauth/profile",
            "https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1",
        ]);
        expect(f.posts()).toHaveLength(0);
        expect((await f.consume(ticket.id)).outcome).toBe("reset");
        expect(f.credentials.every(c => c.provider === provider && c.account === f.account)).toBe(true);
        for (const call of f.calls) {
            expect(new URL(call.url).origin).toBe("https://api.anthropic.com");
            expect(call.init.redirect).toBe("error");
            expect(call.init.signal).toBeInstanceOf(AbortSignal);
            const headers = new Headers(call.init.headers);
            expect(headers.get("authorization")).toBe("Bearer " + SECRET);
            expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20");
            expect(headers.get("content-type")).toBe("application/json");
            expect(headers.get("user-agent")).toBe("claude-cli/reset-test (external, cli)");
            if (call.init.method === "GET") { expect(call.ms).toBe(10_000); expect(call.init.body).toBeUndefined(); }
        }
        const write = f.posts()[0]!;
        expect(f.posts()).toHaveLength(1);
        expect(write.url).toBe(`https://api.anthropic.com/api/organizations/${ORGANIZATION}/reset_rate_limits`);
        expect(write.ms).toBe(25_000);
        expect(JSON.parse(String(write.init.body))).toEqual({ program: "cedar_ember", grant_id: "weekly_reset", request_id: ticket.id });
        assertSafeResult(await savedAttempt(f, ticket.id));
    });

    const badRead: Array<[string, "profile" | "usage", () => Promise<Response>]> = [
        ["profile transport error", "profile", async () => { throw new Error(PRIVATE_ERROR); }],
        ["profile HTTP failure", "profile", async () => new Response(PRIVATE_ERROR, { status: 401 })],
        ["profile JSON failure", "profile", async () => new Response(PRIVATE_ERROR)],
        ["invalid organization", "profile", async () => Response.json({ organization: { uuid: "https://evil.invalid/" + SECRET } })],
        ["missing organization", "profile", async () => Response.json({ debug: PRIVATE_ERROR })],
        ["usage transport error", "usage", async () => { throw new Error(PRIVATE_ERROR); }],
        ["usage HTTP failure", "usage", async () => new Response(PRIVATE_ERROR, { status: 500 })],
        ["usage JSON failure", "usage", async () => new Response(PRIVATE_ERROR)],
        ["usage wrong shape", "usage", async () => Response.json([PRIVATE_ERROR])],
    ];
    for (const [label, endpoint, read] of badRead) test(`${label} is sanitized and cannot send POST`, async () => {
        const f = await fixture(); f.realStatus();
        if (endpoint === "profile") f.setProfile(read); else f.setUsage(read);
        let message = "";
        try { await f.prepare(); } catch (error) { message = String(error); }
        expect(message).toContain("Could not verify Claude reset availability");
        expect(message).not.toContain(SECRET);
        expect(message).not.toContain("private-account@example.invalid");
        expect(f.posts()).toHaveLength(0);
    });

    test("status revalidation failures are sanitized, terminal, and do not reach POST", async () => {
        const f = await fixture(); const ticket = await f.prepare();
        f.setStatus(async () => { throw new Error(PRIVATE_ERROR); });
        const result = await f.consume(ticket.id);
        expect(result.outcome).toBe("unavailable");
        expect((await f.consume(ticket.id)).outcome).toBe("unavailable");
        expect(f.calls).toHaveLength(0);
        assertSafeResult(result);
    });

    for (const [label, read] of badRead.filter(([, endpoint]) => endpoint === "profile").map(([label, , read]) => [label, read] as const)) test(`final bearer ${label} never leaks or sends POST`, async () => {
        const f = await fixture(); const ticket = await f.prepare(); f.setProfile(read);
        const result = await f.consume(ticket.id);
        expect(result.outcome === "unavailable" || result.outcome === "changed").toBe(true);
        expect(f.posts()).toHaveLength(0);
        assertSafeResult(result);
        assertSafeResult(await savedAttempt(f, ticket.id));
    });
});
