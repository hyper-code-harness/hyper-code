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
): Promise<{ sub: string; email: string; name: string; hd: string }> {
    const parts = String(opts.idToken ?? "").split(".");
    if (parts.length !== 3) throw new Error("google: malformed id_token");
    const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    const header = decode(parts[0]!);
    const claims = decode(parts[1]!);
    if (header.alg !== "RS256" || !header.kid) throw new Error("google: unexpected token algorithm");

    const cache = ((ctx.state as any).authGoogleJwks ??= { keys: new Map<string, CryptoKey>(), fetchedAt: 0 });
    let key: CryptoKey | undefined = cache.keys.get(header.kid);
    if (!key) {
        const res = await fetch(opts.jwksUrl ?? "https://www.googleapis.com/oauth2/v3/certs");
        if (!res.ok) throw new Error("google: cannot fetch signing keys");
        const jwks: any = await res.json();
        cache.keys = new Map();
        for (const jwk of jwks.keys ?? []) {
            if (jwk.kty !== "RSA" || !jwk.kid) continue;
            cache.keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
        }
        cache.fetchedAt = Date.now();
        key = cache.keys.get(header.kid);
    }
    if (!key) throw new Error("google: unknown signing key");
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, Buffer.from(parts[2]!, "base64url"), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) throw new Error("google: bad signature");

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new Error("google: wrong issuer");
    if (claims.aud !== opts.clientId) throw new Error("google: wrong audience");
    if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("google: token expired");
    if (!opts.nonce || claims.nonce !== opts.nonce) throw new Error("google: nonce mismatch");
    if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("google: email not verified");
    const email = String(claims.email ?? "").toLowerCase();
    const domain = String(opts.domain ?? "").toLowerCase();
    if (!domain) throw new Error("google: no allowed domain configured");
    if (String(claims.hd ?? "").toLowerCase() !== domain || !email.endsWith("@" + domain)) {
        throw new Error(`google: only ${domain} accounts may sign in`);
    }
    if (!claims.sub) throw new Error("google: missing subject");
    return { sub: String(claims.sub), email, name: String(claims.name ?? email.split("@")[0]), hd: domain };
}
