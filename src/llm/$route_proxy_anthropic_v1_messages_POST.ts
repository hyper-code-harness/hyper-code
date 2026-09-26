// Relay an Anthropic Messages request through this instance's Claude
// subscription. The body passes through untouched (streaming included); only the
// credential and the Claude Code identity headers are ours. Rate-limit headers
// and error statuses are forwarded verbatim so the caller's classifyError sees
// the same 429/reset information it would get from Anthropic directly.
/**
 * Proxy an Anthropic Messages API call for another Hyper instance using this instance's Claude subscription.
 * @param opts.req Incoming request carrying the Anthropic JSON body and the proxy bearer token.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming request carrying the Anthropic JSON body and the proxy bearer token. */
        req: Request;
    },
): Promise<Response> {
    const auth = await ctx.fns.llm.proxyAuthorize({ req: opts.req });
    if (!auth.ok) return auth.response;
    const apiKey = await ctx.fns.llm.refreshClaudeCode({ account: "default" });
    if (!apiKey) return Response.json({ error: "claude-code: no credentials on the proxy host" }, { status: 503 });
    const body = await opts.req.text();
    let model = "";
    try { model = String(JSON.parse(body)?.model ?? ""); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
    const cliVersion = await ctx.fns.llm.claudeCodeCliVersion({});
    const baseBeta = ["claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"];
    const headers: Record<string, string> = {
        "content-type": "application/json",
        "anthropic-version": opts.req.headers.get("anthropic-version") ?? "2023-06-01",
        "anthropic-beta": opts.req.headers.get("anthropic-beta") ?? ctx.env.CLAUDE_CODE_ANTHROPIC_BETA ?? baseBeta.join(","),
        authorization: `Bearer ${apiKey}`,
        "user-agent": ctx.env.CLAUDE_CODE_USER_AGENT ?? `claude-cli/${cliVersion} (external, sdk-cli)`,
        "x-app": "cli",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-client-request-id": Bun.randomUUIDv7(),
    };
    const started = performance.now();
    const upstream = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body, signal: opts.req.signal });
    const out = new Headers();
    for (const name of ["content-type", "request-id", "anthropic-request-id", "retry-after", "cache-control"]) {
        const v = upstream.headers.get(name); if (v) out.set(name, v);
    }
    upstream.headers.forEach((v, k) => { if (k.startsWith("anthropic-ratelimit-")) out.set(k, v); });
    ctx.fns.procs.log.info({ event: "llm.proxy", client: auth.client, model, status: upstream.status, durationMs: Math.round(performance.now() - started) });
    return new Response(upstream.body, { status: upstream.status, headers: out });
}
