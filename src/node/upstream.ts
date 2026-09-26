// The host side of a relay: given a catalogue entry (own provider + account),
// produce the upstream URL and the exact headers our own stream* functions
// would send — fresh subscription token, Claude Code / Codex CLI identity —
// so a relayed request is indistinguishable from a local one.
/**
 * Resolve upstream URL and authenticated headers for relaying one model call through an own provider
 *
 * Refreshes subscription credentials (claude-code, anthropic-oauth, codex,
 * kimi-coding) exactly like the local stream functions and adds the identity
 * headers each provider requires. Returns null when no credential is available.
 * @param opts.provider Own provider name, e.g. "claude-code".
 * @param opts.account Credential account within the provider. @default "default"
 * @param opts.api Wire api of the request being relayed.
 * @param opts.sessionId Client-supplied session id forwarded to providers that key caches on it.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Own provider name. */
        provider: string;
        /** Credential account. @default "default" */
        account?: string;
        /** Wire api of the request being relayed. */
        api: "anthropic" | "responses" | "openai";
        /** Client session id forwarded to cache-keyed providers. */
        sessionId?: string;
    },
): Promise<{ url: string; headers: Record<string, string>; kind: string } | null> {
    const account = opts.account ?? "default";
    const ep = await ctx.fns.llm.resolveEndpoint({ model: `${opts.provider}${account === "default" ? "" : `/${account}`}:x` });
    if (ep.api !== opts.api) throw new Error(`model api mismatch: ${opts.provider} speaks ${ep.api}, request is ${opts.api}`);
    let apiKey: string | null = ep.apiKey;
    if (ep.provider === "claude-code") apiKey = await ctx.fns.llm.refreshClaudeCode({ account }) ?? apiKey;
    else if (ep.provider === "anthropic-oauth") apiKey = await ctx.fns.llm.getAnthropicOAuthToken({ account });
    else if (ep.provider === "kimi-coding") apiKey = await ctx.fns.llm.refreshKimiCode({ account }) ?? apiKey;
    else if (ep.provider === "codex") apiKey = await ctx.fns.llm.refreshCodex({ account }) ?? apiKey;
    if (!apiKey) return null;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (ep.api === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
        const claude = ep.provider === "claude-code" || ep.provider === "anthropic-oauth";
        if (claude || ep.provider === "kimi-coding") headers.authorization = `Bearer ${apiKey}`; else headers["x-api-key"] = apiKey;
        if (claude) {
            const cliVersion = await ctx.fns.llm.claudeCodeCliVersion({});
            headers["anthropic-beta"] = ctx.env.CLAUDE_CODE_ANTHROPIC_BETA ?? ["claude-code-20250219", "oauth-2025-04-20", "fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"].join(",");
            headers["user-agent"] = ctx.env.CLAUDE_CODE_USER_AGENT ?? `claude-cli/${cliVersion} (external, sdk-cli)`;
            headers["x-app"] = "cli";
            headers["anthropic-dangerous-direct-browser-access"] = "true";
            headers["x-client-request-id"] = Bun.randomUUIDv7();
        }
    } else if (ep.api === "responses" && ep.provider === "codex") {
        headers.authorization = `Bearer ${apiKey}`;
        headers["chatgpt-account-id"] = accountIdOf(apiKey);
        headers.originator = "codex_cli_rs";
        headers.version = await ctx.fns.llm.codexCliVersion({});
        headers["OpenAI-Beta"] = "responses=experimental";
        headers.accept = "text/event-stream";
        if (opts.sessionId) headers.session_id = opts.sessionId;
    } else {
        headers.authorization = `Bearer ${apiKey}`;
    }
    return { url: ep.url, headers, kind: ep.kind };
}

function accountIdOf(token: string): string {
    const payload = token.split(".")[1] ?? "";
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    const id = json?.["https://api.openai.com/auth"]?.chatgpt_account_id;
    if (!id) throw new Error("codex token has no chatgpt_account_id");
    return String(id);
}
