// Google OAuth tokens and client credentials are bootstrapped from 1Password
// once, then served and rotated from encrypted local Postgres storage.
/**
 * Resolve a valid Google OAuth access token.
 *
 * @param opts - Options for the operation.
 * @param opts.account - Google account email to use; defaults to `GOOGLE_ACCOUNT` when supported.
 */
export default async function (ctx: Context, _session: Session | null, opts?: { account?: string }) {
    let account = opts?.account ?? ctx.env.GOOGLE_ACCOUNT;
    if (!account) {
        const all = await ctx.fns.google.accounts({});
        if (all.length === 1) account = all[0]!;
        else throw new Error(`Specify account. Authorized: ${all.join(", ") || "(none)"} (or set GOOGLE_ACCOUNT). Run google.reauth({ account }) to add one.`);
    }

    const cache = ((ctx.state as any).google ??= { tokens: {} as Record<string, { access_token: string; expires_at: number }> });
    const cached = cache.tokens[account];
    if (cached && Date.now() < cached.expires_at - 60_000) return { account, access_token: cached.access_token };
    const tokenName = `token:${account}`;
    // Every authorized account uses the same stable local key. secrets.get
    // reads encrypted local storage first; there is no account allowlist.
    const tokenRaw = await ctx.fns.secrets.get({ ref: `op://hyper/google/${tokenName}`, namespace: "google", name: tokenName });
    if (!tokenRaw) throw new Error(`No token for ${account}. Run google.reauth({ account: "${account}" })`);
    let token = JSON.parse(tokenRaw);

    if (!token.expires_at || Date.now() > token.expires_at - 60_000) {
        const secretRaw = await ctx.fns.secrets.get({ ref: "op://hyper/google/client", namespace: "google", name: "client" });
        if (!secretRaw) throw new Error("Google OAuth client is not configured");
        const secret = JSON.parse(secretRaw);
        const creds = secret.installed || secret.web;
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: creds.client_id,
                client_secret: creds.client_secret,
                refresh_token: token.refresh_token,
                grant_type: "refresh_token",
            }),
        });
        const json: any = await res.json();
        if (!res.ok || !json?.access_token) throw new Error(`Token refresh failed for ${account}: ${JSON.stringify(json)}`);
        token = { access_token: json.access_token, refresh_token: json.refresh_token ?? token.refresh_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000 };
        await ctx.fns.secrets.putLocal({ namespace: "google", name: tokenName, value: JSON.stringify(token), source: "oauth-refresh" });
    }

    cache.tokens[account] = { access_token: token.access_token, expires_at: token.expires_at };
    return { account, access_token: token.access_token };
}
