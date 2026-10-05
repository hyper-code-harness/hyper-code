/**
 * Verifies an OpenID Connect ID token or signed assertion (RS256 or ES256) against the issuer's JWKS and returns its claims.
 *
 * Checks signature, issuer, audience, expiry and — when given — nonce. Generic over the provider: used for the
 * Hyper Control Plane and for Google. Keys are cached per JWKS URL and refetched on an unknown key id.
 * @param opts.idToken Compact JWT from the token endpoint.
 * @param opts.issuer Expected `iss`; accepts a list for providers with several spellings.
 * @param opts.clientId Expected `aud` (this Hyper's client ID).
 * @param opts.jwksUri Where the issuer publishes its signing keys.
 * @param opts.nonce Nonce sent in the authorization request; required on the code flow, omitted on refresh.
 * @param opts.leewaySec Clock skew tolerated when checking `exp`, in seconds. @default 60 @minimum 0
 * @param opts.maxLifetimeSec When set, reject tokens whose `exp` lies more than this many seconds ahead (short-lived assertions). @minimum 1
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Compact JWT from the token endpoint. */
        idToken: string;
        /** Expected `iss`; accepts a list for providers with several spellings. */
        issuer: string | string[];
        /** Expected `aud` (this Hyper's client ID). */
        clientId: string;
        /** Where the issuer publishes its signing keys. */
        jwksUri: string;
        /** Nonce sent in the authorization request; required on the code flow, omitted on refresh. */
        nonce?: string;
        /** Clock skew tolerated when checking `exp`, in seconds. @default 60 @minimum 0 */
        leewaySec?: number;
        /** When set, reject tokens whose `exp` lies more than this many seconds ahead (short-lived assertions). @minimum 1 */
        maxLifetimeSec?: number;
    },
): Promise<Record<string, any>> {
    const parts = String(opts.idToken ?? "").split(".");
    if (parts.length !== 3) throw new Error("malformed id_token");
    const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    if ((header.alg !== "RS256" && header.alg !== "ES256") || !header.kid) throw new Error("unexpected token algorithm");

    const cache = ((ctx.state as any).authJwks ??= new Map<string, Map<string, CryptoKey>>());
    let keys: Map<string, CryptoKey> | undefined = cache.get(opts.jwksUri);
    if (!keys?.has(header.kid)) {
        const res = await fetch(opts.jwksUri);
        if (!res.ok) throw new Error("cannot fetch signing keys");
        const set: any = await res.json();
        keys = new Map();
        for (const jwk of set.keys ?? []) {
            if (!jwk.kid) continue;
            if (jwk.kty === "RSA") keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
            else if (jwk.kty === "EC" && jwk.crv === "P-256") keys.set(jwk.kid, await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
        }
        cache.set(opts.jwksUri, keys);
    }
    const key = keys.get(header.kid);
    if (!key) throw new Error("unknown signing key");
    // The key type must match the header: an RSA key never verifies an ES256 token and vice versa.
    const algorithm = header.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
    if (key.algorithm.name !== (header.alg === "ES256" ? "ECDSA" : "RSASSA-PKCS1-v1_5")) throw new Error("key does not match token algorithm");
    const ok = await crypto.subtle.verify(algorithm, key, Buffer.from(parts[2]!, "base64url"), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) throw new Error("bad signature");

    const issuers = Array.isArray(opts.issuer) ? opts.issuer : [opts.issuer];
    if (!issuers.includes(claims.iss)) throw new Error("wrong issuer");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(opts.clientId)) throw new Error("wrong audience");
    const now = Math.floor(Date.now() / 1000);
    const leeway = opts.leewaySec ?? 60;
    if (typeof claims.exp !== "number" || claims.exp < now - leeway) throw new Error("token expired");
    if (opts.maxLifetimeSec !== undefined && claims.exp > now + opts.maxLifetimeSec + leeway) throw new Error("token lifetime too long");
    if (opts.nonce !== undefined && claims.nonce !== opts.nonce) throw new Error("nonce mismatch");
    if (!claims.sub) throw new Error("missing subject");
    return claims;
}
