/**
 * Send a Claude request through the shared managed subscription pool with quota-only failover
 *
 * Use for local streaming, nonstreaming, compaction and inbound Hyper Claude requests. Outside the pool, Claude Code retries one 401 only when refreshing the rejected bearer returns a different token and the body is replayable. Other providers perform one ordinary connectFetch. With the pool enabled, overrides only authorization, keeps body and headers, records actual account usage, and retries only confirmed exhausted quota before handing out a response. Never replays a successful stream, rotates on auth/format errors, changes model, or sends managed tokens to a non-Anthropic URL.
 * @param opts.provider Resolved provider; only claude-code and anthropic-oauth may enter the pool.
 * @param opts.account Original credential slot, used only when the pool is disabled. @default default
 * @param opts.url Provider endpoint; pooled credentials are restricted to https://api.anthropic.com/v1/messages.
 * @param opts.init HTTP request with replayable JSON string body, identity headers and optional abort signal; body and model are preserved.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Resolved provider; only claude-code and anthropic-oauth may enter the pool. */
        provider: string;
        /** Original credential slot, used only when the pool is disabled. @default default */
        account?: string;
        /** Provider endpoint; pooled credentials are restricted to https://api.anthropic.com/v1/messages. */
        url: string;
        /** HTTP request with replayable JSON string body, identity headers and optional abort signal; body and model are preserved. */
        init: RequestInit;
    },
): Promise<{ response: Response; provider: string; account: string; pooled: boolean }> {
    // Observe only physical model sends, after the actual credential is selected.
    // The ledger ignores calls outside its model-operation scope (e.g. quota refresh).
    let model = "unknown";
    if (typeof opts.init.body === "string") {
        try {
            const value = JSON.parse(opts.init.body)?.model;
            if (typeof value === "string") model = value;
        } catch { /* Malformed request bodies remain the provider's validation concern. */ }
    }
    const send = (provider: string, account: string, init: RequestInit): Promise<Response> => {
        const request = () => ctx.fns.llm.connectFetch({ url: opts.url, init });
        return typeof ctx.fns.llmUsage?.fetch === "function"
            ? ctx.fns.llmUsage.fetch({ provider, account, model, api: "anthropic", send: request })
            : request();
    };
    const claude = opts.provider === "claude-code" || opts.provider === "anthropic-oauth";
    let pool = claude ? await ctx.fns.llm.claudePoolSelect({}) : null;
    if (!pool?.enabled) {
        const account = opts.account ?? "default";
        // Snapshot before awaiting HTTP: another caller may mutate shared headers
        // while this response is in flight. Recovery must reject what we sent.
        const headers = new Headers(opts.init.headers);
        const rejectedToken = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1];
        const init = opts.provider === "claude-code" ? { ...opts.init, headers: Object.fromEntries(headers) } : opts.init;
        let response = await send(opts.provider, account, init);
        // A 401 rejects this exact bearer, not whichever token is now cached.
        // Keep the original response readable when no replacement is available.
        if (opts.provider === "claude-code" && response.status === 401 && rejectedToken
            && (opts.init.body == null || typeof opts.init.body === "string")) {
            let fresh: string | null;
            try {
                opts.init.signal?.throwIfAborted();
                fresh = await ctx.fns.llm.refreshClaudeCode({ account, rejectedToken });
            } catch (cause) {
                // Cleanup must not mask the refresh/abort failure, even if the stream rejects cancellation.
                try { await response.body?.cancel(); } catch { throw cause; }
                throw cause;
            }
            if (fresh && fresh !== rejectedToken) {
                await response.body?.cancel();
                opts.init.signal?.throwIfAborted();
                const retryHeaders = new Headers(headers);
                retryHeaders.set("authorization", `Bearer ${fresh}`);
                response = await send(opts.provider, account, { ...init, headers: retryHeaders });
            }
        }
        return { response, provider: opts.provider, account, pooled: false };
    }
    if (opts.url !== "https://api.anthropic.com/v1/messages") throw new Error("Claude pool credentials may only be sent to the Anthropic Messages endpoint");
    if (typeof opts.init.body !== "string") throw new Error("Claude pool requires a replayable JSON string body");
    const tried = new Set<string>();
    while (pool.enabled) {
        opts.init.signal?.throwIfAborted();
        if (!pool.account) return await ctx.fns.llm.claudePoolExhausted({ resetsAt: pool.resetsAt });
        const account = pool.account;
        if (tried.has(account)) throw new Error("Claude pool refused to retry an account twice in one request");
        tried.add(account);
        const headers = new Headers(opts.init.headers);
        headers.delete("x-api-key");
        headers.set("authorization", `Bearer ${await ctx.fns.llm.getAnthropicOAuthToken({ account })}`);
        opts.init.signal?.throwIfAborted();
        const response = await send("anthropic-oauth", account, { ...opts.init, headers, redirect: "error" });
        // Observability failure must never turn an accepted response into a replay.
        try { await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account, headers: response.headers }); }
        catch (error) { console.error("Claude pool quota recording failed:", error instanceof Error ? error.message : "unknown error"); }
        if (response.ok) return { response, provider: "anthropic-oauth", account, pooled: true };
        const info = ctx.fns.llm.classifyError({ provider: "anthropic-oauth", account, kind: "subscription", status: response.status, body: await response.clone().text(), headers: response.headers });
        let exhausted = info.kind === "usage_limit";
        let resetsAt = info.resetsAt ?? null;
        if (info.kind === "rate_limit") {
            // An ordinary 429 is NOT proof of an exhausted subscription. Check authoritative quota.
            let status = await ctx.fns.llm.claudePoolSelect({});
            let quota = status.accounts.find(a => a.account === account);
            if (quota?.available !== false) {
                await ctx.fns.llm.refreshUsage({ provider: "anthropic-oauth", account, accounts: [{ provider: "anthropic-oauth", account }], maxAgeMs: 0, timeoutMs: 2000 });
                status = await ctx.fns.llm.claudePoolSelect({});
                quota = status.accounts.find(a => a.account === account);
            }
            exhausted = quota?.available === false;
            resetsAt = quota?.resetsAt ?? null;
        }
        if (!exhausted) return { response, provider: "anthropic-oauth", account, pooled: true };
        const snapshot = (await ctx.fns.llm.claudePoolSelect({})).accounts.find(a => a.account === account);
        if (snapshot?.resetsAt != null) resetsAt = Math.max(resetsAt ?? 0, snapshot.resetsAt);
        // Close only the failed, not-yet-forwarded response. A successful stream is never replayed.
        await response.body?.cancel();
        pool = await ctx.fns.llm.claudePoolSelect({ failedAccount: account, resetsAt });
        await ctx.fns.llm.recordUsage({ provider: "anthropic-oauth", account, spent: true, resetsAt: resetsAt ?? Date.now() + 3_600_000 });
    }
    throw new Error("Claude pool was disabled during a quota retry; retry the request");
}
