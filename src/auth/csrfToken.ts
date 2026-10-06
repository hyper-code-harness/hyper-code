/**
 * Derives a CSRF token bound to whoever is signed in on this request
 *
 * Creates a deterministic origin-independent token from the stable authenticated identity, the same for the page
 * that renders it and the write that submits it. Binding, in order:
 * - a server-side OIDC session (cookie jti `s_…`): its session id, so silent access-cookie renewal — even of an
 *   already expired access cookie — keeps already-open pages valid;
 * - any other valid signed session cookie (password, Google, legacy): the cookie itself;
 * - no usable cookie but the person is known without one — portal trust (the hub's signed X-Hn-Assertion) or the
 *   open no-user mode: a server-keyed value for that user (or for the open instance), which a cross-site page
 *   cannot compute.
 * Use in server-rendered state-changing forms and the page's csrf-token meta; verify with auth.verifyCsrf.
 * Returns an empty string when nobody is signed in.
 * @param opts.req Incoming page request carrying the session cookie or the portal assertion.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Incoming page request carrying the session cookie or the portal assertion. */
        req: Request;
    },
): Promise<string> {
    const name = ctx.fns.procs.auth.cookieName({});
    const digest = async (binding: string) =>
        Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hyper-csrf-v2:${name}:${binding}`))).toString("base64url");

    const cookie = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(name);
    if (cookie) {
        // Signature always checked; expiry only matters for plain cookies — an OIDC access cookie expires every
        // 15 minutes and is renewed on this same request, its session id stays the binding.
        const claims = await ctx.fns.procs.auth.verify({ token: cookie, allowExpired: true }).catch(() => null);
        if (claims && !claims.kind) {
            if (claims.jti && String(claims.jti).startsWith("s_")) return digest(`oidc:${claims.jti}`);
            if (typeof claims.exp !== "number" || claims.exp * 1000 >= Date.now()) return digest(`cookie:${cookie}`);
        }
    }

    // No usable cookie: the person may still be known (portal trust) or nobody needs to be (open instance).
    const who = await ctx.fns.auth.currentUser({ req: opts.req });
    const subject = who.user && who.required ? `portal:${who.user.id}` : !who.required ? "open" : "";
    if (!subject) return "";
    // The subject is guessable, so key it with the workspace's private signing key (RSASSA-PKCS1-v1_5 is
    // deterministic): only this server can produce the token, a cross-site page cannot.
    const cache = ((ctx.state as any).authCsrfKeyed ??= new Map<string, string>());
    let keyed = cache.get(subject);
    if (!keyed) {
        const { privateKey } = await ctx.fns.procs.auth.keys({});
        const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`hyper-csrf-keyed:${subject}`));
        keyed = Buffer.from(sig).toString("base64url");
        cache.set(subject, keyed);
    }
    return digest(`keyed:${keyed}`);
}
