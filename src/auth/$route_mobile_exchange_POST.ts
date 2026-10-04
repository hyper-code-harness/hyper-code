/** Exchanges a native SSO handoff code for the regular Hyper session cookie. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const body = await opts.req.json().catch(() => null) as { code?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code : "";
    if (!code) return Response.json({ error: "invalid_code", message: "Missing sign-in code" }, { status: 400 });
    const exchanged = await ctx.fns.auth.exchangeMobileSession({ code, req: opts.req });
    if (!exchanged) return Response.json({ error: "invalid_code", message: "Sign-in code expired or was already used" }, { status: 401, headers: { "cache-control": "no-store" } });
    return Response.json({ ok: true, user: exchanged.user }, { headers: { "set-cookie": exchanged.setCookie, "cache-control": "no-store" } });
}
