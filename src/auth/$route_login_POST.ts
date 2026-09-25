/**
 * Signs a user in and issues the session cookie.
 *
 * Accepts form or JSON with `password` and, when there is more than one user, `email`.
 * A single-user install keeps password-only sign-in, so existing clients continue to work.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const isJson = (opts.req.headers.get("content-type") ?? "").includes("application/json");
    let email = "", password = "", next = "/";
    if (isJson) {
        const body: any = await opts.req.json().catch(() => ({}));
        email = typeof body.email === "string" ? body.email : "";
        password = typeof body.password === "string" ? body.password : "";
        next = typeof body.next === "string" ? body.next : "/";
    } else {
        const form = await opts.req.formData();
        email = String(form.get("email") ?? "");
        password = String(form.get("password") ?? "");
        next = String(form.get("next") ?? "/");
    }
    if (!next.startsWith("/") || next.startsWith("//")) next = "/";

    const user = await ctx.fns.auth.verifyUser({ email: email || null, password });
    if (!user) {
        await Bun.sleep(250);
        return isJson
            ? Response.json({ error: "invalid_credentials", message: "Invalid credentials" }, { status: 401 })
            : new Response(null, { status: 303, headers: { location: `/auth/login?error=1&next=${encodeURIComponent(next)}`, "cache-control": "no-store" } });
    }
    const cookie = await ctx.fns.auth.issueSession({ user, req: opts.req });
    const headers = { "set-cookie": cookie, "cache-control": "no-store" };
    return isJson
        ? Response.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { headers })
        : new Response(null, { status: 303, headers: { ...headers, location: next } });
}
