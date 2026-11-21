/**
 * Read fresh Claude reset grants and the authenticated organization without spending a reset
 *
 * Use before preparing or confirming a Claude reset. Reads only the official Anthropic OAuth profile and usage endpoints, rejects redirects and malformed organization identifiers, and returns no credentials. CLI base URL overrides are never used for reset operations.
 * @param opts.provider Local Claude credential adapter; remote/node credentials are not supported.
 * @param opts.account Exact configured credential slot; no fallback to another account.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Local Claude credential adapter; remote/node credentials are not supported. */
        provider: "claude-code" | "anthropic-oauth";
        /** Exact configured credential slot; no fallback to another account. */
        account: string;
    },
): Promise<types.llm.ClaudeResetState> {
    if (!['claude-code', 'anthropic-oauth'].includes(opts.provider) || typeof opts.account !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(opts.account)) throw new Error('Invalid Claude account');
        try {
            const token = opts.provider === 'claude-code' ? await ctx.fns.llm.refreshClaudeCode({account: opts.account}) : await ctx.fns.llm.getAnthropicOAuthToken({account: opts.account});
            if (!token) throw new Error('Missing credential');
            const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'claude-cli/' + await ctx.fns.llm.claudeCodeCliVersion({}) + ' (external, cli)' };
            const read = async (path: string): Promise<Record<string, unknown>> => {
                const res = await ctx.fns.llm.connectFetch({url: 'https://api.anthropic.com/api/oauth/' + path, ms: 10000, init: {method:'GET', headers, redirect:'error', signal: AbortSignal.timeout(10000)}});
                if (!res.ok) { await res.body?.cancel(); throw new Error('Read refused'); }
                const data: unknown = await res.json();
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
                return data as Record<string, unknown>;
            };
            const profile = await read('profile');
            const organization = profile.organization as {uuid?: unknown} | undefined;
            if (typeof organization?.uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organization.uuid)) throw new Error('Invalid organization');
            const data = await read('usage?cedar_ember=1&skip_spend=1');
            const status = data.cedar_ember as Record<string, unknown> | undefined;
            const resetCredits = await ctx.fns.llm.parseClaudeResetCredits({status});
            const nextGrantId = typeof status?.next_grant_id === 'string' && resetCredits.credits?.some(c=>c.id === status.next_grant_id) ? status.next_grant_id : null;
            const rawCooldown = status?.cooldown_until;
            const cooldownUntil = rawCooldown == null ? null : typeof rawCooldown === 'string' && Number.isFinite(Date.parse(rawCooldown)) ? Date.parse(rawCooldown) : Number.MAX_SAFE_INTEGER;
            return { organizationId: organization.uuid, resetCredits, nextGrantId, cooldownUntil };
        } catch {
            throw new Error('Could not verify Claude reset availability. Refresh accounts or reconnect this account; no reset was sent.');
        }
}
