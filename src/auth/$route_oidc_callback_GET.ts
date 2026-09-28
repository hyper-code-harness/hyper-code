/**
 * Completes sign-in through the OIDC provider: checks state, exchanges the code with the PKCE verifier,
 * verifies the ID token (signature, issuer, audience, expiry, nonce), finds or creates the Hyper user, and
 * starts a server-side session with the provider's refresh token. Any failure returns to the sign-in page.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookieUrl = forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url;
    const clear = ctx.fns.procs.auth.cookie({ name: "hyper_oidc_state", url: cookieUrl });
    const fail = (message: string) => {
        ctx.fns.procs.log.warn({ event: "auth.oidc.failed", msg: message });
        return new Response(null, { status: 303, headers: { location: `/auth/login?error=${encodeURIComponent(message)}`, "cache-control": "no-store", "set-cookie": clear } });
    };
    const cfg = await ctx.fns.auth.oidcConfig({});
    if (!cfg) return new Response("Sign-in provider is not configured", { status: 404 });
    const url = new URL(opts.req.url);
    if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") || "Sign-in was cancelled");
    const raw = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get("hyper_oidc_state");
    const carried: any = raw ? await ctx.fns.procs.auth.verify({ token: raw }) : null;
    const code = url.searchParams.get("code");
    if (!code || !carried || carried.kind !== "oidc-state" || carried.sub !== url.searchParams.get("state")) return fail("Sign-in expired, try again");

    const res = await fetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + btoa(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`) },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ctx.fns.auth.oidcRedirectUri({ req: opts.req }), code_verifier: String(carried.jti) }),
    }).catch(() => null);
    if (!res?.ok) return fail("The sign-in provider did not accept the sign-in");
    const tokens: any = await res.json();

    let claims: Record<string, any>;
    try {
        claims = await ctx.fns.auth.verifyIdToken({ idToken: String(tokens.id_token ?? ""), issuer: cfg.issuer, clientId: cfg.clientId, jwksUri: cfg.jwksUri, nonce: String(carried.name) });
    } catch (e) { return fail(String((e as Error).message)); }
    const email = String(claims.email ?? "").toLowerCase();
    if (!email) return fail("The provider did not share an email");

    // Same identity table as Google: provider 'oidc', subject = the control plane's stable user id.
    const user = await ctx.fns.auth.linkIdentity({ provider: "oidc", sub: String(claims.sub), email, name: String(claims.name ?? email.split("@")[0]), picture: typeof claims.picture === "string" ? claims.picture : null });
    if (!user) return fail(`${email} is not allowed to sign in to this Hyper`);

    const s = await ctx.fns.auth.oidcSession({ action: "create", req: opts.req, userId: user.id, refreshToken: tokens.refresh_token ?? null });
    let next = String(carried.email || "/");
    if (!next.startsWith("/") || next.startsWith("//")) next = "/";
    const headers = new Headers({ location: next, "cache-control": "no-store" });
    if (s.setCookie) headers.append("set-cookie", s.setCookie);
    headers.append("set-cookie", clear);
    return new Response(null, { status: 303, headers });
}
