/** Clears the Hyper session cookie and ends a server-side OIDC session, if the cookie names one. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const raw = new Bun.CookieMap(opts.req.headers.get("cookie") ?? "").get(ctx.fns.procs.auth.cookieName({}));
    const claims: any = raw ? await ctx.fns.procs.auth.verify({ token: raw, allowExpired: true }).catch(() => null) : null;
    const sid = String(claims?.jti ?? "");
    if (sid.startsWith("s_")) {
        await ctx.fns.procs.db.run({ sql: "UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", params: [Date.now(), sid] }).catch(() => {});
    }
    const forwardedProto = opts.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const cookieURL = forwardedProto === "https" ? "https://hyper.invalid/" : opts.req.url;
    const cookie = ctx.fns.procs.auth.cookie({ url: cookieURL });
    const json = (opts.req.headers.get("accept") ?? "").includes("application/json");
    return json ? Response.json({ ok: true }, { headers: { "set-cookie": cookie } }) : new Response(null, { status: 303, headers: { "set-cookie": cookie, location: "/auth/login" } });
}
