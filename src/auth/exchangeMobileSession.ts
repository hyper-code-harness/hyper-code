/**
 * Exchange a native handoff code for a Hyper session cookie
 *
 * Consumes a short-lived single-use code returned by the mobile browser SSO callback and issues the normal Hyper session cookie for the bound user. Use only from the dedicated mobile authentication exchange route.
 * @param opts.code Single-use native handoff code received by the app.
 * @param opts.req Exchange HTTP request used to issue a correctly secured cookie.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Single-use native handoff code received by the app. */
        code: string;
        /** Exchange HTTP request used to issue a correctly secured cookie. */
        req: Request;
    },
): Promise<{ user: types.auth.User; setCookie: string } | null> {
    const code = opts.code.trim();
    const state: Map<string, { userId: string; sid: string | null; expiresAt: number }> | undefined = (ctx.state as any).mobileAuthHandoffs;
    const handoff = state?.get(code);
    if (!handoff) return null;
    state!.delete(code);
    if (handoff.expiresAt <= Date.now()) return null;
    const user = await ctx.fns.auth.getUser({ id: handoff.userId });
    if (!user || user.disabledAt != null) return null;
    if (handoff.sid) {
        // Join the browser's control-plane session: same sid, a short access token renewed by auth.oidcSession like any OIDC cookie.
        const rows = await ctx.fns.procs.db.select({ sql: "SELECT user_id, expires_at, revoked_at FROM auth_sessions WHERE id = ?", params: [handoff.sid] }) as any[];
        const s = rows[0];
        if (!s || s.revoked_at != null || Number(s.expires_at) < Date.now() || String(s.user_id) !== String(user.id)) return null;
        const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
        const cookieUrl = forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url;
        const ACCESS_SECONDS = 15 * 60;
        const token = await ctx.fns.procs.auth.sign({ sub: user.id, name: user.name, email: user.email ?? undefined, role: user.role, jti: handoff.sid, seconds: ACCESS_SECONDS });
        return { user, setCookie: ctx.fns.procs.auth.cookie({ token, url: cookieUrl, days: ACCESS_SECONDS / 86400 * 4 }) };
    }
    if (await ctx.fns.auth.oidcOnly({})) return null; // OIDC-only servers accept nothing but control-plane sessions
    return { user, setCookie: await ctx.fns.auth.issueSession({ user, req: opts.req, days: 30 }) };
}
