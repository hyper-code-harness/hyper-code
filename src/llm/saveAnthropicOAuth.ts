/** Save an encrypted Anthropic subscription login and invalidate the account inventory. */
/**
 * Encrypt and persist Anthropic OAuth credentials.
 * @param opts.access OAuth access token.
 * @param opts.refresh OAuth refresh token.
 * @param opts.expiresAt Access-token expiration time as a Unix timestamp in milliseconds.
 * @param opts.scopes Granted OAuth scopes.
 * @param opts.account Named credential slot, allowing several Claude logins side by side.
 * @param opts.label Human-readable name for the account, e.g. the e-mail.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** OAuth bearer token to encrypt and store. */ access: string;
        /** OAuth refresh token to encrypt and store. */ refresh: string;
        /** Access-token expiration as Unix milliseconds. */ expiresAt: number;
        /** Granted OAuth scopes, if supplied by the provider. */ scopes?: string | null;
        /** Credential slot within the provider. @default "default" */ account?: string;
        /** Human-readable account name shown in the UI. */ label?: string | null },
): Promise<{ ok: true }> {
    const provider = "anthropic-oauth";
    const account = normalizeAccount(opts.account);
    const [accessEnc, refreshEnc] = await Promise.all([
        ctx.fns.llm.encryptOAuthSecret({ provider, field: "access", value: opts.access }),
        ctx.fns.llm.encryptOAuthSecret({ provider, field: "refresh", value: opts.refresh }),
    ]);
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO oauth_credentials
            (provider, account, label, access_enc, refresh_enc, expires_at, scopes, metadata, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 1, ?, ?)
            ON CONFLICT(provider, account) DO UPDATE SET access_enc=excluded.access_enc,
              refresh_enc=excluded.refresh_enc, expires_at=excluded.expires_at,
              scopes=excluded.scopes, label=COALESCE(excluded.label, oauth_credentials.label),
              version=oauth_credentials.version+1, updated_at=excluded.updated_at`,
        params: [provider, account, opts.label ?? null, accessEnc, refreshEnc, opts.expiresAt, opts.scopes ?? null, now, now],
    });
    const state = (ctx.state as typeof ctx.state & { llm?: { accountInventoryCache?: Map<string, unknown> } }).llm;
    if (state) delete state.accountInventoryCache;
    return { ok: true };
}

// One spelling of "the only account": an empty slot and "default" are the same
// thing, so old callers and new ones cannot end up with two rows.
function normalizeAccount(account: string | undefined): string {
    const value = String(account ?? "").trim();
    return value && value !== "default" ? value.slice(0, 40) : "default";
}
