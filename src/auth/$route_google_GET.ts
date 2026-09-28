/**
 * Starts "Sign in with Google": redirects to Google with a signed, single-use state.
 *
 * Available only when Google sign-in is configured (auth.googleClientId + googleClientSecret);
 * otherwise 404, and password sign-in is unaffected. The state and nonce travel in a short-lived
 * signed cookie that never counts as a session. `hd` asks Google to show only accounts of the
 * allowed domain (the callback still verifies it).
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const config = await ctx.fns.auth.googleConfig({});
    if (!config) return new Response("Google sign-in is not configured", { status: 404 });
    const url = new URL(opts.req.url);
    let next = url.searchParams.get("next") || "/";
    if (!next.startsWith("/") || next.startsWith("//")) next = "/";
    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const redirectUri = ctx.fns.auth.googleRedirectUri({ req: opts.req });
    const token = await ctx.fns.procs.auth.sign({ sub: state, name: nonce, email: next, kind: "google-state", seconds: 600 });
    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookie = ctx.fns.procs.auth.cookie({ name: "hyper_google_state", token, url: forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url, days: 1 / 144 });
    const google = new URL(ctx.env.HYPER_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth");
    google.searchParams.set("client_id", config.clientId);
    google.searchParams.set("redirect_uri", redirectUri);
    google.searchParams.set("response_type", "code");
    google.searchParams.set("scope", "openid email profile");
    google.searchParams.set("state", state);
    google.searchParams.set("nonce", nonce);
    google.searchParams.set("hd", config.domain);
    google.searchParams.set("prompt", "select_account");
    return new Response(null, { status: 303, headers: { location: google.toString(), "set-cookie": cookie, "cache-control": "no-store" } });
}
