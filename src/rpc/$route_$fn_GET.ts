// GET /rpc/<fn>?<json> — the page made by a `@view` function, by address (rpc.render does the call). The query
// is the call's params as JSON (rpc.url builds the canonical form); `?a=1&b=2` is accepted for hand-typed links.
// Only functions tagged `@view` answer: GET carries no CSRF token, so it must not change anything.
// The answer is an html fragment: htmx gets it alone, a browser visit gets it inside the Hyper page layout
// (procs.http.toResponse decides by HX-Request).

/** Serves the page of a `@view` function at its address. */
export default async function (ctx: Context, session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<{ main: string; title: string; status: number }> {
    const name = String(opts.params.fn ?? "").trim();
    const u = new URL(opts.req.url);
    // The global middleware put the signed-in person on the session; a direct call asks here.
    let user = (session as any)?.user ?? null;
    if (!user) {
        const who = await ctx.fns.auth.currentUser({ req: opts.req });
        user = who.user;
        // A renewed OIDC session cookie rides on the session; the dispatcher adds it to the response.
        if (who.setCookie && session) (session as any).setCookie = who.setCookie;
        if (who.required && !who.user && !who.legacy) return { main: ctx.fns.rpc.page({ title: name, error: "sign in to open this page" }), title: name, status: 401 };
    }
    // An open instance (no sign-in configured) is its owner's: the page reads as the owner.
    if (!user) user = ((await ctx.fns.procs.db.select({ sql: "SELECT id, email, name, role FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1", params: [] })) as any[])[0] ?? null;
    const r = await ctx.fns.rpc.render({ url: `/rpc/${encodeURIComponent(name)}${u.search}`, user });
    return { main: r.html, title: name || "rpc", status: r.status };
}
