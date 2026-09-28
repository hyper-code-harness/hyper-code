/**
 * Verifies a Google ID token and returns its identity claims, or throws.
 *
 * Checks the RS256 signature against Google's published keys (cached per key id), then issuer,
 * audience, expiry, nonce, a verified email, and that the account belongs to the allowed Workspace
 * domain (the `hd` claim and the email domain must both match). Use in the Google sign-in callback.
 * @param opts.idToken ID token returned by Google's token endpoint.
 * @param opts.clientId OAuth client ID the token must be issued for.
 * @param opts.nonce Nonce sent in the authorization request.
 * @param opts.domain Allowed Google Workspace domain, e.g. health-samurai.io.
 * @param opts.jwksUrl Override of Google's JWKS endpoint, for tests. @default https://www.googleapis.com/oauth2/v3/certs
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** ID token returned by Google's token endpoint. */
        idToken: string;
        /** OAuth client ID the token must be issued for. */
        clientId: string;
        /** Nonce sent in the authorization request. */
        nonce: string;
        /** Allowed Google Workspace domain, e.g. health-samurai.io. */
        domain: string;
        /** Override of Google's JWKS endpoint, for tests. @default https://www.googleapis.com/oauth2/v3/certs */
        jwksUrl?: string;
    },
): Promise<{ sub: string; email: string; name: string; hd: string; picture: string | null }> {
    if (!opts.nonce) throw new Error("google: nonce mismatch");
    const claims = await ctx.fns.auth.verifyIdToken({
        idToken: opts.idToken, clientId: opts.clientId, nonce: opts.nonce,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        jwksUri: opts.jwksUrl ?? "https://www.googleapis.com/oauth2/v3/certs",
    }).catch((e: Error) => { throw new Error("google: " + e.message.replace(/^google: /, "")); });
    if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("google: email not verified");
    const email = String(claims.email ?? "").toLowerCase();
    const domain = String(opts.domain ?? "").toLowerCase();
    if (!domain) throw new Error("google: no allowed domain configured");
    if (String(claims.hd ?? "").toLowerCase() !== domain || !email.endsWith("@" + domain)) {
        throw new Error(`google: only ${domain} accounts may sign in`);
    }
    const picture = typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture : null;
    return { sub: String(claims.sub), email, name: String(claims.name ?? email.split("@")[0]), hd: domain, picture };
}
