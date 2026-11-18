/**
 * Send a provider request with one bounded recovery of a rejected Claude Code bearer token
 *
 * Use for direct CLI-backed Claude calls, streaming, compaction and inbound relays. Only Claude Code HTTP 401 triggers a refresh with the exact rejected token, and only a different token permits one replay. Other providers pass through. Accepted streams, network failures and non-replayable bodies are never retried; caller headers are snapshotted before sending.
 * @param opts.provider Resolved credential provider. Only claude-code enables 401 recovery.
 * @param opts.account Claude Code credential slot used for refresh. @default default
 * @param opts.url Resolved provider endpoint URL.
 * @param opts.init Request options including headers, abort signal and a replayable JSON string body.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Resolved credential provider. Only claude-code enables 401 recovery. */
        provider: string;
        /** Claude Code credential slot used for refresh. @default default */
        account?: string;
        /** Resolved provider endpoint URL. */
        url: string;
        /** Request options including headers, abort signal and a replayable JSON string body. */
        init: RequestInit;
    },
): Promise<Response> {
    const headers = new Headers(opts.init.headers);
    const rejectedToken = /^Bearer\s+(.+)$/i.exec(headers.get("authorization") ?? "")?.[1];
    const init = opts.provider === "claude-code" ? { ...opts.init, headers: Object.fromEntries(headers.entries()) } : opts.init;
    let response = await ctx.fns.llm.connectFetch({ url: opts.url, init });
    if (opts.provider !== "claude-code" || response.status !== 401 || !rejectedToken) return response;
    if (opts.init.body != null && typeof opts.init.body !== "string") return response;
    try {
        opts.init.signal?.throwIfAborted();
        const fresh = await ctx.fns.llm.refreshClaudeCode({ account: opts.account, rejectedToken });
        if (!fresh || fresh === rejectedToken) return response;
        await response.body?.cancel();
        opts.init.signal?.throwIfAborted();
        const retryHeaders = new Headers(headers);
        retryHeaders.set("authorization", "Bearer " + fresh);
        response = await ctx.fns.llm.connectFetch({ url: opts.url, init: { ...init, headers: Object.fromEntries(retryHeaders.entries()) } });
        return response;
    } catch (error) {
        await response.body?.cancel();
        throw error;
    }
}
