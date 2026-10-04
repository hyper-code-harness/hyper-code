/**
 * Completes browser SSO for the native iOS client by redirecting a short-lived handoff code to its callback URL.
 *
 * This route is reached only after normal Hyper authentication. It never exposes the browser's HttpOnly
 * session cookie; the app exchanges the one-time code through `/auth/mobile/exchange` instead.
 */
export default async function (ctx: Context, session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const user = (session as any)?.user as types.auth.User | undefined;
    if (!user) return Response.json({ error: "unauthorized", message: "Authentication required" }, { status: 401 });
    // Carry the browser's control-plane session (jti "s_…") so the app joins it: renewals stay single-flight and
    // OIDC-only servers (HYPER_OIDC_ONLY) accept the app cookie. Password/Google sessions carry no sid.
    const raw = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(ctx.fns.procs.auth.cookieName({})) ?? "";
    const claims: any = raw ? await ctx.fns.procs.auth.verify({ token: raw }).catch(() => null) : null;
    const sid = String(claims?.jti ?? "").startsWith("s_") && String(claims?.sub) === String(user.id) ? String(claims.jti) : null;
    const { code } = await ctx.fns.auth.createMobileSession({ userId: user.id, sid });
    const callback = new URL("hypermobile://auth/callback");
    callback.searchParams.set("code", code);
    return new Response(null, { status: 303, headers: { location: callback.toString(), "cache-control": "no-store" } });
}
