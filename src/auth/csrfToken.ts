/**
 * Derives a CSRF token bound to the current signed session cookie
 *
 * Creates a deterministic origin-independent token from the opaque authenticated session cookie. Use in server-rendered state-changing forms; callers should escape the returned value before HTML insertion. Returns an empty string when no session cookie exists.
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
    const bytes = new TextEncoder().encode(`hyper-csrf-v1:${name}:${cookie}`);
    return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("base64url");
}
