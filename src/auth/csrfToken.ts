/**
 * Derives a CSRF token bound to the current signed session cookie
 *
 * Creates a deterministic origin-independent token from the stable authenticated session identity. OIDC cookie renewal keeps the same server-side session id, so already-open pages remain valid. Use in server-rendered state-changing forms; callers should escape the returned value before HTML insertion. Returns an empty string when no valid session cookie exists.
 * @param opts.req Incoming page request carrying the session cookie.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming page request carrying the session cookie. */
        req: Request;
    },
): Promise<string> {
    const name = ctx.fns.procs.auth.cookieName({});
    const cookie = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(name);
    if (!cookie) return "";
    const claims = await ctx.fns.procs.auth.verify({ token: cookie }).catch(() => null);
    if (!claims || claims.kind) return "";
    // OIDC access cookies rotate every few minutes, but their opaque server-side
    // session id remains stable. Plain password/Google cookies do not rotate.
    const binding = claims.jti && String(claims.jti).startsWith("s_") ? `oidc:${claims.jti}` : `cookie:${cookie}`;
    const bytes = new TextEncoder().encode(`hyper-csrf-v2:${name}:${binding}`);
    return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("base64url");
}
