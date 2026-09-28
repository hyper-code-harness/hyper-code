/**
 * Creates, checks and silently renews an OIDC sign-in session (Backend-for-Frontend).
 *
 * The browser holds only a short-lived signed cookie naming a server-side session (`sid`). The provider's
 * refresh token is stored encrypted in `auth_sessions`. When the cookie is close to expiry, the session is
 * renewed with the provider's refresh_token grant (rotated each time); if the provider refuses (user
 * disabled, token reused, session maxed out), the session is revoked and the person must sign in again.
 * Use `action: "create"` after a successful code exchange, `"resolve"` on each request.
 * @param opts.action create a session, or resolve (and maybe renew) the one in the request cookie.
 * @param opts.req Incoming request (cookie source; also picks cookie security flags).
 * @param opts.userId User to create the session for (create only).
 * @param opts.refreshToken Provider refresh token (create only).
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
    },
): Promise<{ user: types.auth.User | null; setCookie: string | null }> {
    const db = ctx.fns.procs.db;
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
        const refreshEnc = opts.refreshToken ? await ctx.fns.secrets.encryptLocal({ namespace: "auth-session", name: sid, value: opts.refreshToken }) : null;
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
    if (!sid.startsWith("s_")) return { user: claims.__expired ? null : await ctx.fns.auth.getUser({ id: String(claims.sub) }), setCookie: null };

    const rows = await db.select({ sql: "SELECT * FROM auth_sessions WHERE id = ? AND revoked_at IS NULL", params: [sid] }) as any[];
    const s = rows[0];
    if (!s || Number(s.expires_at) < Date.now() || String(s.user_id) !== String(claims.sub)) return { user: null, setCookie: null };
    const user = await ctx.fns.auth.getUser({ id: s.user_id });
    if (!user) return { user: null, setCookie: null };

    const secondsLeft = Number(claims.exp ?? 0) - Math.floor(Date.now() / 1000);
    if (!claims.__expired && secondsLeft > RENEW_BEFORE) return { user, setCookie: null };

    // Renew through the provider: this is where a disabled user or a stolen/reused token is caught.
    const cfg = await ctx.fns.auth.oidcConfig({});
    if (!cfg || !s.refresh_enc) {
        // Provider not configured or unreachable: allow a short grace only if the token is still valid.
        return { user: claims.__expired ? null : user, setCookie: null };
    }
    const refreshToken = await ctx.fns.secrets.decryptLocal({ namespace: "auth-session", name: sid, envelope: String(s.refresh_enc) });
    const res = await fetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`) },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    }).catch(() => null);
    if (!res) return { user: claims.__expired ? null : user, setCookie: null }; // network blip: keep a valid token, don't revoke
    if (!res.ok) {
        await db.run({ sql: "UPDATE auth_sessions SET revoked_at = ? WHERE id = ?", params: [Date.now(), sid] });
        ctx.fns.procs.log.info({ event: "auth.oidc.renew_refused", msg: `session ${sid} for ${user.id} ended by the provider` });
        return { user: null, setCookie: null };
    }
    const t: any = await res.json();
    const enc = t.refresh_token ? await ctx.fns.secrets.encryptLocal({ namespace: "auth-session", name: sid, value: String(t.refresh_token) }) : s.refresh_enc;
    await db.run({ sql: "UPDATE auth_sessions SET refresh_enc = ?, refreshed_at = ? WHERE id = ?", params: [enc, Date.now(), sid] });
    return { user, setCookie: await cookieFor(user, sid) };
}
