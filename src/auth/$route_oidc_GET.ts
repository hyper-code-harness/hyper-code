/**
 * Starts sign-in through the OIDC provider (Hyper Control Plane): authorization code + PKCE S256 + state + nonce.
 * The PKCE verifier, nonce and return path travel in a short-lived signed single-purpose cookie. 404 when off.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const cfg = await ctx.fns.auth.oidcConfig({});
    if (!cfg) return new Response("Sign-in provider is not configured", { status: 404 });
    let next = new URL(opts.req.url).searchParams.get("next") || "/";
    if (!next.startsWith("/") || next.startsWith("//")) next = "/";
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
    // One signed, single-purpose token (kind) carries what the callback needs; never a session.
    const carry = await ctx.fns.procs.auth.sign({ sub: state, name: nonce, email: next, jti: verifier, kind: "oidc-state", seconds: 600 });
    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookie = ctx.fns.procs.auth.cookie({ name: "hyper_oidc_state", token: carry, url: forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url, days: 1 / 144 });
    const u = new URL(cfg.authorizationEndpoint);
    for (const [k, v] of Object.entries({
        client_id: cfg.clientId, redirect_uri: ctx.fns.auth.oidcRedirectUri({ req: opts.req }), response_type: "code",
        scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256",
    })) u.searchParams.set(k, v);
    return new Response(null, { status: 303, headers: { location: u.toString(), "set-cookie": cookie, "cache-control": "no-store" } });
}
