/**
 * Returns the OpenID Connect sign-in configuration with the provider's discovered endpoints, or null when off.
 *
 * Sign-in through a provider (the Hyper Control Plane) is optional: it is on only when issuer, client ID and
 * client secret are set. Endpoints come from the issuer's /.well-known/openid-configuration, cached for 10
 * minutes. The secret may be an op:// or secret:// reference. Password sign-in is unaffected.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{
    issuer: string;
    clientId: string;
    clientSecret: string;
    label: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    jwksUri: string;
} | null> {
    const setting = (key: string) => ctx.fns.settings.get({ module: "auth", scopeType: "global", key });
    const issuer = String((await setting("oidcIssuer")) ?? "").trim().replace(/\/+$/, "");
    const clientId = String((await setting("oidcClientId")) ?? "").trim();
    const rawSecret = String((await setting("oidcClientSecret")) ?? "").trim();
    if (!issuer || !clientId || !rawSecret) return null;
    const clientSecret = /^(op|secret|env):\/\//.test(rawSecret)
        ? String((await ctx.fns.secrets.get({ ref: rawSecret, namespace: "auth", name: "oidcClientSecret" })) ?? "")
        : rawSecret;
    if (!clientSecret) return null;

    const cache = ((ctx.state as any).authOidcDiscovery ??= new Map<string, { at: number; doc: any }>());
    let hit = cache.get(issuer);
    if (!hit || Date.now() - hit.at > 600_000) {
        const res = await fetch(`${issuer}/.well-known/openid-configuration`).catch(() => null);
        if (!res?.ok) return null; // provider down: the sign-in button hides, password still works
        const doc: any = await res.json();
        if (String(doc.issuer ?? "").replace(/\/+$/, "") !== issuer) return null;
        hit = { at: Date.now(), doc };
        cache.set(issuer, hit);
    }
    return {
        issuer, clientId, clientSecret,
        label: String((await setting("oidcLabel")) ?? "Health Samurai"),
        authorizationEndpoint: String(hit.doc.authorization_endpoint),
        tokenEndpoint: String(hit.doc.token_endpoint),
        jwksUri: String(hit.doc.jwks_uri),
    };
}
