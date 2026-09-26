/**
 * Refreshes cached subscription quota for one or all configured LLM accounts
 *
 * Fetch live quota windows from provider-specific subscription usage endpoints for Codex, Claude and xAI/SuperGrok, then persist them through llm.recordUsage. Use before rendering /llms or the sidebar; requests are cached briefly and individual account failures are returned without failing the whole refresh.
 * @param opts.provider Only refresh this provider.
 * @param opts.account Only refresh this credential account.
 * @param opts.maxAgeMs Reuse a recent successful refresh for this many milliseconds. @default 60000 @minimum 0 @maximum 3600000
 * @param opts.timeoutMs Deadline for each provider usage request in milliseconds. @default 5000 @minimum 500 @maximum 30000
 * @param opts.now Current timestamp in milliseconds, for testing.
 * @param opts.accounts Explicit account inventory, primarily for callers that already listed accounts and for tests.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Only refresh this provider. */
        provider?: string;
        /** Only refresh this credential account. */
        account?: string;
        /** Reuse a recent successful refresh for this many milliseconds. @default 60000 @minimum 0 @maximum 3600000 */
        maxAgeMs?: number;
        /** Deadline for each provider usage request in milliseconds. @default 5000 @minimum 500 @maximum 30000 */
        timeoutMs?: number;
        /** Current timestamp in milliseconds, for testing. */
        now?: number;
        /** Explicit account inventory, primarily for callers that already listed accounts and for tests. */
        accounts?: Array<{ provider: string; account: string }>;
    },
): Promise<Array<{ provider: string; account: string; status: "refreshed" | "cached" | "unsupported" | "failed"; error: string | null }>> {
    const now = opts.now ?? Date.now();
    const maxAgeMs = Math.max(0, Number(opts.maxAgeMs ?? 60_000));
    const timeoutMs = Math.max(500, Number(opts.timeoutMs ?? 5_000));
    const inventory = opts.accounts ?? (await ctx.fns.llm.listAccounts({ provider: opts.provider })).map((a: any) => ({ provider: a.provider, account: a.account }));
    const accounts = inventory.filter((a: any) => (!opts.provider || a.provider === opts.provider) && (!opts.account || a.account === opts.account));
    const results = await Promise.all(accounts.map(async (item: any) => {
        const provider = String(item.provider);
        const account = String(item.account || "default");
        if (!["codex", "claude-code", "anthropic-oauth", "xai"].includes(provider)) return { provider, account, status: "unsupported" as const, error: null };
        const cacheKey = `llm:usage-refresh:${provider}:${account}`;
        const cached = ((await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = ?", params: [cacheKey] })) as any[])[0];
        if (cached && now - Number(cached.value ?? 0) < maxAgeMs) return { provider, account, status: "cached" as const, error: null };
        try {
            if (provider === "codex") await refreshCodex(ctx, account, timeoutMs, now);
            else if (provider === "xai") await refreshXai(ctx, account, timeoutMs, now);
            else await refreshClaude(ctx, provider as "claude-code" | "anthropic-oauth", account, timeoutMs, now);
            await ctx.fns.llm.accountAuthHealth({ action: "clear", provider, account });
            await ctx.fns.procs.db.run({ sql: "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", params: [cacheKey, String(now)] });
            return { provider, account, status: "refreshed" as const, error: null };
        } catch (error: any) {
            const message = sanitize(error?.message ?? error);
            // A failed telemetry request says nothing about inference quota.
            // Hide the stale snapshot so the UI cannot present an old 100% as
            // a current hard limit while normal Claude calls still succeed.
            const hidden = await ctx.fns.procs.db.run({ sql: "DELETE FROM kv WHERE key = ?", params: [`llm:usage:${provider}:${account}`] }).catch(() => ({ changes: 0 }));
            // Signal only when the rendered rings actually changed. The usage
            // route itself calls this function, so an unconditional signal made
            // every failed read (e.g. a provider 429) re-fetch the route, fail
            // again and signal again — a request loop about once a second.
            if (hidden.changes > 0) { try { ctx.fns.procs.events.refresh({ topic: "llm-usage", reason: "usage refresh failed" }); } catch {} }
            return { provider, account, status: "failed" as const, error: message };
        }
    }));
    return results;
    
    async function refreshCodex(ctx: Context, account: string, timeoutMs: number, now: number): Promise<void> {
        const token = await ctx.fns.llm.refreshCodex({ account });
        if (!token) throw new Error("credential is unavailable");
        const payload = decodeJwt(token);
        const accountId = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
        const res = await ctx.fns.llm.connectFetch({
            url: "https://chatgpt.com/backend-api/wham/usage",
            ms: timeoutMs,
            init: { method: "GET", headers: {
                authorization: `Bearer ${token}`,
                ...(accountId ? { "chatgpt-account-id": String(accountId) } : {}),
                "user-agent": "codex-cli",
            } },
        });
        if (!res.ok) {
            if (res.status === 401) await ctx.fns.llm.accountAuthHealth({ action: "mark", provider: "codex", account });
            throw new Error(`usage endpoint returned ${res.status}`);
        }
        const data: any = await res.json();
        const detail = data?.rate_limit ?? data?.rate_limits?.find?.((x: any) => x?.limit_id === "codex") ?? data?.rate_limits?.[0];
        const primary = normalizeCodexWindow(detail?.primary_window ?? detail?.primary, now);
        const secondary = normalizeCodexWindow(detail?.secondary_window ?? detail?.secondary, now);
        if (!primary && !secondary) throw new Error("usage endpoint returned no quota windows");
        const resetSummary = data?.rate_limit_reset_credits;
        let resetCredits = resetSummary && Number.isFinite(Number(resetSummary.available_count)) ? {
            availableCount: Number(resetSummary.available_count),
            ...(Array.isArray(resetSummary.credits) ? { credits: resetSummary.credits.map(normalizeResetCredit) } : {}),
        } : null;
        if (resetCredits && resetCredits.availableCount > 0 && !resetCredits.credits) {
            const detailRes = await ctx.fns.llm.connectFetch({
                url: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
                ms: timeoutMs,
                init: { method: "GET", headers: {
                    authorization: `Bearer ${token}`,
                    ...(accountId ? { "chatgpt-account-id": String(accountId) } : {}),
                    "user-agent": "codex-cli",
                } },
            });
            if (detailRes.ok) {
                const detailData: any = await detailRes.json();
                resetCredits = {
                    availableCount: Number.isFinite(Number(detailData?.available_count)) ? Number(detailData.available_count) : resetCredits.availableCount,
                    credits: Array.isArray(detailData?.credits) ? detailData.credits.map(normalizeResetCredit) : [],
                };
            }
        }
        await ctx.fns.llm.recordUsage({ provider: "codex", account, rateLimits: { primary, secondary }, planType: data?.plan_type ?? null, resetCredits, now });
    }
    
    async function refreshXai(ctx: Context, account: string, timeoutMs: number, now: number): Promise<void> {
        const token = await ctx.fns.llm.getXaiOAuthToken({ account });
        if (!token) throw new Error("credential is unavailable");
        const res = await ctx.fns.llm.connectFetch({
            url: "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
            ms: timeoutMs,
            init: { method: "GET", headers: {
                authorization: `Bearer ${token}`,
                accept: "application/json",
                "x-grok-client-mode": "cli",
                "x-grok-client-version": "1.0.4",
            } },
        });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) await ctx.fns.llm.accountAuthHealth({ action: "mark", provider: "xai", account });
            throw new Error(`usage endpoint returned ${res.status}`);
        }
        const data: any = await res.json();
        const config = data?.config;
        const used = Number(config?.creditUsagePercent);
        const cap = Number(config?.onDemandCap?.val);
        const onDemandUsed = Number(config?.onDemandUsed?.val);
        const usedPercent = Number.isFinite(used) ? used
            : Number.isFinite(cap) && cap > 0 && Number.isFinite(onDemandUsed) ? onDemandUsed / cap * 100
                : NaN;
        if (!Number.isFinite(usedPercent)) throw new Error("usage endpoint returned no quota percentage");
        const resetRaw = config?.currentPeriod?.end ?? config?.billingPeriodEnd;
        const resetMs = Date.parse(String(resetRaw ?? ""));
        const period = String(config?.currentPeriod?.type ?? "").toLowerCase();
        const windowMinutes = period.includes("weekly") ? 10080 : period.includes("monthly") ? 43200 : null;
        const planType = String(config?.subscriptionTier ?? data?.subscriptionTier ?? "").trim() || null;
        await ctx.fns.llm.recordUsage({ provider: "xai", account, rateLimits: { primary: {
            used_percent: usedPercent,
            window_minutes: windowMinutes,
            resets_at: Number.isFinite(resetMs) ? Math.floor(resetMs / 1000) : null,
        } }, planType, now });
    }


    async function refreshClaude(ctx: Context, provider: "claude-code" | "anthropic-oauth", account: string, timeoutMs: number, now: number): Promise<void> {
        const token = provider === "claude-code"
            ? await ctx.fns.llm.refreshClaudeCode({ account })
            : await ctx.fns.llm.getAnthropicOAuthToken({ account });
        if (!token) throw new Error("credential is unavailable");
        const base = String(ctx.env.CLAUDE_CODE_BASE_API_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
        const res = await ctx.fns.llm.connectFetch({
            url: `${base}/api/oauth/usage`,
            ms: timeoutMs,
            init: { method: "GET", headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                "user-agent": ctx.env.CLAUDE_CODE_USER_AGENT ?? `claude-cli/${await ctx.fns.llm.claudeCodeCliVersion({})} (external, sdk-cli)`,
            } },
        });
        if (!res.ok) throw new Error(`usage endpoint returned ${res.status}`);
        const data: any = await res.json();
        const headers: Record<string, string> = {};
        addClaudeWindow(headers, "5h", data?.five_hour);
        addClaudeWindow(headers, "7d", data?.seven_day);
        // /api/oauth/usage contains windows but not the subscription name.
        // Claude Code obtains that from the companion OAuth profile endpoint.
        // Profile failure must not discard otherwise valid usage data.
        let planType: string | null = null;
        try {
            const profileRes = await ctx.fns.llm.connectFetch({
                url: `${base}/api/oauth/profile`,
                ms: timeoutMs,
                init: { method: "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } },
            });
            if (profileRes.ok) {
                const profile: any = await profileRes.json();
                planType = claudePlan(profile?.organization?.organization_type);
            }
        } catch { /* usage remains useful when profile metadata is unavailable */ }
        const snapshot = await ctx.fns.llm.recordUsage({ provider, account, headers, planType, now });
        if (!snapshot) throw new Error("usage endpoint returned no quota windows");
    }
    
    function addClaudeWindow(headers: Record<string, string>, abbrev: "5h" | "7d", window: any): void {
        if (!window || !Number.isFinite(Number(window.utilization))) return;
        headers[`anthropic-ratelimit-unified-${abbrev}-utilization`] = String(Number(window.utilization) / 100);
        const reset = Date.parse(String(window.resets_at ?? ""));
        if (Number.isFinite(reset)) headers[`anthropic-ratelimit-unified-${abbrev}-reset`] = String(Math.floor(reset / 1000));
    }
    
    function claudePlan(organizationType: any): string | null {
        const value = String(organizationType ?? "").toLowerCase();
        return value === "claude_max" ? "max"
            : value === "claude_pro" ? "pro"
            : value === "claude_team" ? "team"
            : value === "claude_enterprise" ? "enterprise"
            : null;
    }
    
    function normalizeResetCredit(credit: any): any {
        return {
            id: String(credit?.id ?? ""),
            resetType: credit?.reset_type ?? credit?.resetType,
            status: credit?.status,
            grantedAt: credit?.granted_at ?? credit?.grantedAt,
            expiresAt: credit?.expires_at ?? credit?.expiresAt ?? null,
            title: credit?.title ?? null,
            description: credit?.description ?? null,
        };
    }


    function normalizeCodexWindow(window: any, now: number): any {
        if (!window || !Number.isFinite(Number(window.used_percent))) return undefined;
        const directReset = Number(window.resets_at ?? window.reset_at);
        const resetAfter = Number(window.reset_after_seconds);
        return {
            used_percent: Number(window.used_percent),
            window_minutes: Number.isFinite(Number(window.window_minutes)) ? Number(window.window_minutes) : Number.isFinite(Number(window.limit_window_seconds)) ? Number(window.limit_window_seconds) / 60 : null,
            resets_at: Number.isFinite(directReset) && directReset > 0 ? directReset : Number.isFinite(resetAfter) ? Math.floor(now / 1000) + resetAfter : null,
        };
    }

    function decodeJwt(token: string): any {
        try { const part = token.split(".")[1]; return part ? JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) : null; } catch { return null; }
    }
    
    function sanitize(value: any): string {
        return String(value ?? "usage refresh failed").replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]").slice(0, 200);
    }
}
