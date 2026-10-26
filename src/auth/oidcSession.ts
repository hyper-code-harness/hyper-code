/**
 * Creates, checks and silently renews an OIDC sign-in session (Backend-for-Frontend).
 *
 * The browser holds only a short-lived signed cookie naming a server-side session (`sid`). The provider's
 * refresh token is stored encrypted in `auth_sessions`. When the cookie is close to expiry, the session is
 * renewed with the provider's refresh_token grant (rotated each time); if the provider refuses (user
 * disabled, token reused, session maxed out), the session is revoked and the person must sign in again.
 * Renewal is serialized per session (shared in-flight promise + row lock) and debounced for 30 s, so
 * concurrent requests from one page never present the same rotated refresh token twice.
 * Use `action: "create"` after a successful code exchange, `"resolve"` on each request.
 * @param opts.action create a session, or resolve (and maybe renew) the one in the request cookie.
 * @param opts.req Incoming request (cookie source; also picks cookie security flags).
 * @param opts.userId User to create the session for (create only).
 * @param opts.refreshToken Provider refresh token (create only).
 * @param opts.accessToken Provider access token from the verified code exchange (create only).
 * @param opts.expiresIn Provider access-token lifetime in seconds, capped at 900. @default 300
 * @param opts.includeAccessToken Include a secret access token only for a server-proven private ingress request. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** create a session, or resolve (and maybe renew) the one in the request cookie. */
        action: "create" | "resolve";
        /** Incoming request (cookie source; also picks cookie security flags). */
        req: Request;
        /** User to create the session for (create only). */
        userId?: string;
        /** Provider refresh token (create only). */
        refreshToken?: string | null;
        /** Provider access token from a verified code exchange; encrypted with the refresh token. */
        accessToken?: string | null;
        /** Provider access-token lifetime in seconds; capped at 15 minutes. @default 300 */
        expiresIn?: number;
        /** Return a secret token only to the private ingress resolver, never UI/RPC. @default false */
        includeAccessToken?: boolean;
    },
): Promise<{ user: types.auth.User | null; setCookie: string | null; accessToken?: string }> {
    if (opts.includeAccessToken && !(ctx.state as any).authLocalIngressRequests?.has(opts.req)) throw new Error("Private session resolution required");
    const db = ctx.fns.procs.db;
    // Versioned bundle in the existing encrypted column: no plaintext storage or migration.
    const unpack = (value: string): { refreshToken: string; accessToken?: string; accessExpiresAt?: number } => {
        if (!value.startsWith("{")) return { refreshToken: value }; // legacy encrypted refresh token
        const parsed = JSON.parse(value);
        if (parsed.version !== 1 || typeof parsed.refreshToken !== "string") throw new Error("Invalid session envelope");
        return parsed;
    };
    const lifetime = (seconds: number | undefined) => Math.max(0, Math.min(900, Number.isFinite(seconds) ? Number(seconds) : 300)) * 1000;
    const readBundle = async (envelope: string, sid: string) => unpack(await ctx.fns.secrets.decryptLocal({ namespace: "auth-session", name: sid, envelope }));
    const ACCESS_SECONDS = 15 * 60;          // cookie lifetime; renewed silently
    const RENEW_BEFORE = 2 * 60;             // renew this close to expiry
    const SESSION_MAX_MS = 90 * 86400 * 1000; // hard cap regardless of activity

    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookieUrl = forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url;
    const cookieFor = async (user: types.auth.User, sid: string) => {
        const token = await ctx.fns.procs.auth.sign({ sub: user.id, name: user.name, email: user.email ?? undefined, role: user.role, jti: sid, seconds: ACCESS_SECONDS });
        return ctx.fns.procs.auth.cookie({ token, url: cookieUrl, days: ACCESS_SECONDS / 86400 * 4 }); // cookie outlives the token so renewal can read it
    };

    if (opts.action === "create") {
        const user = opts.userId ? await ctx.fns.auth.getUser({ id: opts.userId }) : null;
        if (!user) return { user: null, setCookie: null };
        const sid = "s_" + Bun.randomUUIDv7().replace(/-/g, "");
        const now = Date.now();
        const refreshEnc = opts.refreshToken ? await ctx.fns.secrets.encryptLocal({ namespace: "auth-session", name: sid, value: JSON.stringify({ version: 1, refreshToken: opts.refreshToken, accessToken: opts.accessToken ?? null, accessExpiresAt: now + lifetime(opts.expiresIn) }) }) : null;
        await db.run({
            sql: "INSERT INTO auth_sessions (id, user_id, provider, refresh_enc, created_at, refreshed_at, expires_at) VALUES (?, ?, 'oidc', ?, ?, ?, ?)",
            params: [sid, user.id, refreshEnc, now, now, now + SESSION_MAX_MS],
        });
        return { user, setCookie: await cookieFor(user, sid) };
    }

    // resolve: read the cookie even if its token expired, so an idle tab renews instead of bouncing to login
    const name = ctx.fns.procs.auth.cookieName({});
    const raw = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(name);
    if (!raw) return { user: null, setCookie: null };
    // Signature always checked; an expired but authentic token may still be renewed.
    const claims: any = await ctx.fns.procs.auth.verify({ token: raw, allowExpired: true });
    if (!claims || claims.kind) return { user: null, setCookie: null };
    claims.__expired = typeof claims.exp === "number" && claims.exp * 1000 < Date.now();
    const sid = String(claims.jti ?? "");
    if (opts.includeAccessToken && !sid.startsWith("s_")) return { user: null, setCookie: null };
    if (!sid.startsWith("s_")) return { user: claims.__expired ? null : await ctx.fns.auth.getUser({ id: String(claims.sub) }), setCookie: null };

    const rows = await db.select({ sql: "SELECT * FROM auth_sessions WHERE id = ? AND revoked_at IS NULL", params: [sid] }) as any[];
    const s = rows[0];
    if (!s || Number(s.expires_at) < Date.now() || String(s.user_id) !== String(claims.sub)) return { user: null, setCookie: null };
    const user = await ctx.fns.auth.getUser({ id: s.user_id });
    if (!user) return { user: null, setCookie: null };

    const secondsLeft = Number(claims.exp ?? 0) - Math.floor(Date.now() / 1000);
    const bundle = opts.includeAccessToken && s.refresh_enc ? await readBundle(String(s.refresh_enc), sid) : null;
    const accessValid = !!bundle?.accessToken && Number(bundle.accessExpiresAt) > Date.now() + 30_000;
    if (!claims.__expired && secondsLeft > RENEW_BEFORE && (!opts.includeAccessToken || accessValid)) return { user, setCookie: null, ...(opts.includeAccessToken ? { accessToken: bundle!.accessToken } : {}) };

    // Renew through the provider: this is where a disabled user or a stolen/reused token is caught.
    // The provider rotates refresh tokens and treats a reused one as theft (it ends the whole sign-in),
    // so concurrent requests of one page must never renew the same session twice:
    // - in-process: requests for one session share a single in-flight renewal (serialization);
    // - across processes/restarts: the renewal runs under a row lock on the session (SELECT … FOR UPDATE);
    // - debounce: a session renewed in the last RENEW_DEBOUNCE_MS just gets a fresh cookie, no provider call.
    const cfg = await ctx.fns.auth.oidcConfig({});
    if (!cfg || !s.refresh_enc) {
        // Provider not configured or unreachable: allow a short grace only if the token is still valid.
        return { user: opts.includeAccessToken || claims.__expired ? null : user, setCookie: null };
    }
    const RENEW_DEBOUNCE_MS = 30_000;
    const inflight: Map<string, Promise<"renewed" | "refused" | "unreachable">> = ((ctx.state as any).authOidcRenewals ??= new Map());
    let pending = inflight.get(sid);
    if (!pending) {
        pending = (async () => {
            const pool: any = await db.conn();
            return await pool.begin(async (tx: any) => {
                const [row] = await tx.unsafe("SELECT refresh_enc, refreshed_at, revoked_at FROM auth_sessions WHERE id = $1 FOR UPDATE", [sid]);
                if (!row || row.revoked_at != null) return "refused";
                const previous = await readBundle(String(row.refresh_enc), sid);
                const validAccess = !!previous.accessToken && Number(previous.accessExpiresAt) > Date.now() + 30_000;
                if (Date.now() - Number(row.refreshed_at) < RENEW_DEBOUNCE_MS && (!opts.includeAccessToken || validAccess)) return "renewed";
                const refreshToken = previous.refreshToken;
                const res = await fetch(cfg.tokenEndpoint, {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`) },
                    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
                    signal: AbortSignal.timeout(10_000),
                }).catch(() => null);
                if (!res) return "unreachable";
                if (!res.ok) {
                    await tx.unsafe("UPDATE auth_sessions SET revoked_at = $1 WHERE id = $2", [Date.now(), sid]);
                    ctx.fns.procs.log.info({ event: "auth.oidc.renew_refused", msg: `session ${sid} for ${user.id} ended by the provider` });
                    return "refused";
                }
                const t: any = await res.json();
                const enc = await ctx.fns.secrets.encryptLocal({ namespace: "auth-session", name: sid, value: JSON.stringify({ version: 1, refreshToken: typeof t.refresh_token === "string" && t.refresh_token ? t.refresh_token : previous.refreshToken, accessToken: typeof t.access_token === "string" ? t.access_token : null, accessExpiresAt: Date.now() + lifetime(t.expires_in) }) });
                await tx.unsafe("UPDATE auth_sessions SET refresh_enc = $1, refreshed_at = $2 WHERE id = $3", [enc, Date.now(), sid]);
                return "renewed";
            });
        })().finally(() => inflight.delete(sid));
        inflight.set(sid, pending);
    }
    const outcome = await pending.catch(() => "unreachable" as const);
    if (outcome === "refused") return { user: null, setCookie: null };
    if (outcome === "unreachable") return { user: opts.includeAccessToken || claims.__expired ? null : user, setCookie: null }; // network blip: keep a valid token, don't revoke
    const setCookie = await cookieFor(user, sid);
    if (opts.includeAccessToken) {
        const latest = await db.select({ sql: "SELECT * FROM auth_sessions WHERE id = ? AND revoked_at IS NULL", params: [sid] }) as any[];
        const row = latest[0];
        const tokens = row?.refresh_enc ? await readBundle(String(row.refresh_enc), sid) : null;
        if (!tokens?.accessToken || Number(tokens.accessExpiresAt) <= Date.now() + 30_000 || !await ctx.fns.auth.getUser({ id: user.id })) return { user: null, setCookie };
        return { user, setCookie, accessToken: tokens.accessToken };
    }
    return { user, setCookie };
}
