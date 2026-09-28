/**
 * Completes "Sign in with Google": checks state, exchanges the code, verifies the ID token and
 * signs the matching Hyper user in.
 *
 * Only verified accounts of the allowed Workspace domain get through (googleVerify). The user is
 * found by Google subject, then by email, then created when auto-create is on (googleSignIn).
 * Any failure returns to the sign-in page with a message; password sign-in keeps working.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const fail = (message: string) => {
        ctx.fns.procs.log.warn({ event: "auth.google.failed", msg: message });
        return new Response(null, { status: 303, headers: { location: `/auth/login?error=${encodeURIComponent(message)}`, "cache-control": "no-store", "set-cookie": clear } });
    };
    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookieUrl = forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url;
    const clear = ctx.fns.procs.auth.cookie({ name: "hyper_google_state", url: cookieUrl });

    const config = await ctx.fns.auth.googleConfig({});
    if (!config) return new Response("Google sign-in is not configured", { status: 404 });
    const url = new URL(opts.req.url);
    if (url.searchParams.get("error")) return fail("Google sign-in was cancelled");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const raw = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get("hyper_google_state");
    const saved: any = raw ? await ctx.fns.procs.auth.verify({ token: raw }) : null;
    if (!code || !state || !saved || saved.kind !== "google-state" || saved.sub !== state) return fail("Sign-in expired, try again");

    const tokenRes = await fetch(ctx.env.HYPER_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code, client_id: config.clientId, client_secret: config.clientSecret,
            redirect_uri: ctx.fns.auth.googleRedirectUri({ req: opts.req }), grant_type: "authorization_code",
        }),
    }).catch(() => null);
    if (!tokenRes || !tokenRes.ok) return fail("Google did not accept the sign-in");
    const tokens: any = await tokenRes.json().catch(() => ({}));

    let identity: { sub: string; email: string; name: string };
    try {
        identity = await ctx.fns.auth.googleVerify({ idToken: String(tokens.id_token ?? ""), clientId: config.clientId, nonce: String(saved.name), domain: config.domain, jwksUrl: ctx.env.HYPER_GOOGLE_JWKS_URL || undefined });
    } catch (e) {
        return fail(String((e as Error).message).replace(/^google: /, ""));
    }
    const user = await ctx.fns.auth.googleSignIn({ ...identity, autoCreate: config.autoCreate });
    if (!user) return fail(`${identity.email} is not allowed to sign in to this Hyper`);

    const session = await ctx.fns.auth.issueSession({ user, req: opts.req });
    let next = String(saved.email || "/");
    if (!next.startsWith("/") || next.startsWith("//")) next = "/";
    const headers = new Headers({ location: next, "cache-control": "no-store" });
    headers.append("set-cookie", session);
    headers.append("set-cookie", clear);
    return new Response(null, { status: 303, headers });
}
