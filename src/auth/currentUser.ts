/**
 * Resolves who is making a request.
 *
 * - no users yet: behaves exactly like before users existed — open when no shared password is
 *   configured, otherwise the legacy shared-password session is required (so deploying this code
 *   before switching an install over never changes sign-in);
 * - a single user without a password: open; that user is the author of everything;
 * - otherwise: a valid session cookie for an active user is required, and the users row is
 *   re-read on every call so a disabled user is rejected immediately.
 * - OIDC-only mode (auth.oidcOnly): always required, and only a server-side OIDC session counts.
 * - portal trust (auth.portalTrust): a valid X-Hn-Assertion from the hypermesh hub signs the person in first.
 * `required` says whether an anonymous request must be turned away.
 * @param opts.req Incoming HTTP request carrying the session cookie.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request carrying the session cookie. */
        req: Request;
    },
): Promise<{ user: types.auth.User | null; required: boolean; legacy?: boolean; setCookie?: string | null }> {
    // Portal trust (auth.portalTrust): a valid signed assertion from the hypermesh hub IS the session for
    // this request — no cookie, so access ends the moment the hub stops vouching. Without one, the rules
    // below apply unchanged (login page, OIDC button, password).
    const portal = await ctx.fns.auth.portalIdentity({ req: opts.req });
    if (portal) return { user: portal.user, required: true };
    if (await ctx.fns.auth.oidcOnly({})) {
        // Only the control plane lets people in: no open mode, no password or legacy sessions.
        const peek: any = await ctx.fns.procs.auth.verify({ token: new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(ctx.fns.procs.auth.cookieName({})) ?? "", allowExpired: true }).catch(() => null);
        if (!String(peek?.jti ?? "").startsWith("s_")) return { user: null, required: true };
        const s = await ctx.fns.auth.oidcSession({ action: "resolve", req: opts.req });
        return { user: s.user, required: true, setCookie: s.setCookie };
    }
    const users = await ctx.fns.auth.listUsers({});
    if (users.length === 0) {
        if (!(await ctx.fns.auth.password({}))) return { user: null, required: false };
        // Legacy shared-password install not switched over yet: a valid legacy session is enough.
        // `required` stays true so the middleware still applies its cross-origin write check.
        const claims: any = await ctx.fns.procs.auth.authenticate({ req: opts.req });
        return { user: null, required: true, legacy: !!claims };
    }
    if (users.length === 1 && !users[0]!.canSignIn) return { user: users[0]!, required: false };
    // Sessions started through the OIDC provider carry a server-side session id (jti "s_…") and are
    // renewed silently; password/Google sessions are plain signed cookies.
    const peek: any = await ctx.fns.procs.auth.verify({ token: new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(ctx.fns.procs.auth.cookieName({})) ?? "", allowExpired: true }).catch(() => null);
    if (String(peek?.jti ?? "").startsWith("s_")) {
        const s = await ctx.fns.auth.oidcSession({ action: "resolve", req: opts.req });
        return { user: s.user, required: true, setCookie: s.setCookie };
    }
    const claims: any = await ctx.fns.procs.auth.authenticate({ req: opts.req });
    const user = claims?.sub ? await ctx.fns.auth.getUser({ id: String(claims.sub) }) : null;
    return { user, required: true };
}
