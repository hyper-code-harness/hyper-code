/**
 * Resolves the person the hypermesh hub vouches for from the signed X-Hn-Assertion request header.
 *
 * Portal-trust sign-in (setting auth.portalTrust, env HYPER_PORTAL_TRUST, off by default). The hub asks the
 * control plane whether the person may open this service and, when yes, adds a short-lived JWT (RS256/ES256)
 * signed with the control plane's OIDC keys. This verifies signature, issuer, `aud` = auth.portalAudience
 * (e.g. `hn:hr/studio/hyper`), expiry and a lifetime of at most 120 s, then finds or creates the user for
 * that person as a member (identity provider `oidc`, subject = `sub`, the same row the OIDC button uses).
 * Returns null when the mode is off, the header is missing or invalid, or the user is disabled — the caller
 * then falls back to the ordinary sign-in. Bare X-Hn-User / X-Hn-* headers are never trusted.
 * Called by auth.currentUser on every request; verified assertions are cached until they expire.
 * @param opts.req Incoming HTTP request that may carry the X-Hn-Assertion header.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request that may carry the X-Hn-Assertion header. */
        req: Request;
    },
): Promise<{ user: types.auth.User; device: string | null } | null> {
    const setting = (key: string) => ctx.fns.settings.get({ module: "auth", scopeType: "global", key });
    const on = await setting("portalTrust");
    if (!(on === true || on === "true" || on === "1")) return null;
    const assertion = opts.req.headers.get("x-hn-assertion")?.trim();
    if (!assertion) return null;

    // The hub sends a fresh assertion with every request of a page load; verify and link once, then only
    // re-read the user (so disabling still takes effect immediately).
    const seen = ((ctx.state as any).authPortalSeen ??= new Map<string, { userId: string; device: string | null; exp: number }>());
    const nowSec = Math.floor(Date.now() / 1000);
    const cached = seen.get(assertion);
    if (cached && cached.exp >= nowSec) {
        const user = await ctx.fns.auth.getUser({ id: cached.userId });
        return user ? { user, device: cached.device } : null;
    }

    const fail = (msg: string) => { ctx.fns.procs.log.warn({ event: "auth.portal.rejected", msg }); return null; };
    const audience = String((await setting("portalAudience")) ?? "").trim();
    const issuer = String((await setting("portalIssuer")) ?? "").trim().replace(/\/+$/, "");
    if (!audience || !issuer) return fail("portal trust is on but auth.portalAudience or auth.portalIssuer is not set");

    // Only the issuer's jwks_uri is needed — no client secret, unlike the OIDC button.
    const discovery = ((ctx.state as any).authPortalDiscovery ??= new Map<string, { at: number; jwksUri: string }>());
    let hit = discovery.get(issuer);
    if (!hit || Date.now() - hit.at > 600_000) {
        const res = await fetch(`${issuer}/.well-known/openid-configuration`).catch(() => null);
        if (!res?.ok) return fail("portal issuer discovery failed");
        const doc: any = await res.json().catch(() => ({}));
        if (String(doc.issuer ?? "").replace(/\/+$/, "") !== issuer || !doc.jwks_uri) return fail("portal issuer discovery document is invalid");
        hit = { at: Date.now(), jwksUri: String(doc.jwks_uri) };
        discovery.set(issuer, hit);
    }

    let claims: Record<string, any>;
    try {
        claims = await ctx.fns.auth.verifyIdToken({ idToken: assertion, issuer: [issuer, issuer + "/"], clientId: audience, jwksUri: hit.jwksUri, leewaySec: 5, maxLifetimeSec: 120 });
    } catch (e) { return fail(String((e as Error).message)); }
    const email = String(claims.email ?? "").toLowerCase();
    if (!email) return fail("assertion has no email");

    const user = await ctx.fns.auth.linkIdentity({
        provider: "oidc", sub: String(claims.sub), email, name: String(claims.name ?? email.split("@")[0]),
        picture: typeof claims.picture === "string" ? claims.picture : null, autoCreate: true, memberOnly: true,
    });
    if (!user) return fail(`${email} is disabled in this Hyper`);
    const device = typeof claims.hn_device === "string" ? claims.hn_device : null;
    for (const [k, v] of seen) if (v.exp < nowSec) seen.delete(k);
    seen.set(assertion, { userId: user.id, device, exp: Number(claims.exp) });
    return { user, device };
}
