/**
 * Encrypt and persist one xAI subscription credential.
 *
 * Stores access and refresh tokens in the shared managed OAuth table using the
 * xai-oauth storage adapter while the callable model provider remains xai.
 *
 * @param opts.access OAuth bearer token returned by xAI.
 * @param opts.refresh OAuth refresh token used to renew access.
 * @param opts.expiresAt Access-token expiry as Unix milliseconds including refresh skew.
 * @param opts.scopes Granted OAuth scope string when returned by xAI.
 * @param opts.account Named credential slot for multi-account routing. @default "default"
 * @param opts.label Human-readable account label shown in LLM settings.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** OAuth bearer token returned by xAI. */ access: string;
    /** OAuth refresh token used to renew access. */ refresh: string;
    /** Access-token expiry as Unix milliseconds including refresh skew. */ expiresAt: number;
    /** Granted OAuth scope string when returned by xAI. */ scopes?: string | null;
    /** Named credential slot for multi-account routing. @default "default" */ account?: string;
    /** Human-readable account label shown in LLM settings. */ label?: string | null;
}): Promise<{ ok: true }> {
    const provider = "xai-oauth", account = String(opts.account ?? "").trim().slice(0, 40) || "default";
    const [accessEnc, refreshEnc] = await Promise.all([
        ctx.fns.llm.encryptOAuthSecret({ provider, field: "access", value: opts.access }),
        ctx.fns.llm.encryptOAuthSecret({ provider, field: "refresh", value: opts.refresh }),
    ]);
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: `INSERT INTO oauth_credentials
      (provider,account,label,access_enc,refresh_enc,expires_at,scopes,metadata,version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'{}',1,?,?) ON CONFLICT(provider,account) DO UPDATE SET
      access_enc=excluded.access_enc,refresh_enc=excluded.refresh_enc,expires_at=excluded.expires_at,scopes=excluded.scopes,
      label=COALESCE(excluded.label,oauth_credentials.label),version=oauth_credentials.version+1,updated_at=excluded.updated_at`,
      params: [provider, account, opts.label ?? null, accessEnc, refreshEnc, opts.expiresAt, opts.scopes ?? null, now, now] });
    const state = (ctx.state as typeof ctx.state & { llm?: { accountInventoryCache?: Map<string, unknown> } }).llm;
    if (state) delete state.accountInventoryCache;
    return { ok: true };
}
