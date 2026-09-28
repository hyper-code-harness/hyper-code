/**
 * Returns a service access token for calling the Hyper Control Plane, or null when not connected.
 *
 * Uses the same client ID and secret as sign-in (auth.oidcConfig) with the standard OAuth 2.0
 * client_credentials grant, scoped to the service catalog. Tokens are cached until a minute before
 * they expire. Use before any call to the control plane's service catalog.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<string | null> {
    const cfg = await ctx.fns.auth.oidcConfig({});
    if (!cfg) return null;
    const cache = ((ctx.state as any).controlPlaneToken ??= { token: null as string | null, until: 0, issuer: "" });
    if (cache.token && cache.issuer === cfg.issuer && Date.now() < cache.until) return cache.token;
    const res = await fetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`) },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "catalog:read catalog:heartbeat" }),
    }).catch(() => null);
    if (!res?.ok) return null;
    const t: any = await res.json();
    cache.token = String(t.access_token);
    cache.until = Date.now() + Math.max(30, Number(t.expires_in ?? 300) - 60) * 1000;
    cache.issuer = cfg.issuer;
    return cache.token;
}
