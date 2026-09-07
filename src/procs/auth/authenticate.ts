// Who is making this request, according to the session cookie it carries. Both
// `on` (magic link) and `sso` (a token the manager minted, swapped for a session
// at /auth/sso) end at the same cookie — this workspace's own signed token — so
// verification is one path. Returns null when there is nobody; the caller
// decides whether that matters.
/**
 * Perform authenticate for the auth subsystem.
 * @param opts.req The incoming HTTP request.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request }) {
    const name = ctx.fns.procs.auth.cookieName({});
    const token = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(name);
    if (!token) return null;
    const claims = await ctx.fns.procs.auth.verify({ token });
    // A token that says what it is FOR — a magic link, an sso handoff, the REPL —
    // is single-purpose: it opens that one door and is nobody afterwards. Only a
    // plain token (no `kind`) is a session.
    return claims?.kind ? null : claims;
}

// The default name, for code that has no ctx at hand (a test fixture).
export const COOKIE = "procs_session";
