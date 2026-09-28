/**
 * Completes first-user setup: names the lone seeded user, or creates the first user.
 *
 * When the lone user already has a password (legacy shared password), it must be supplied, so a
 * stranger reaching a fresh tunnel cannot take over. Signs the user in when they have a password.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    if (await ctx.fns.auth.oidcOnly({})) return new Response(null, { status: 303, headers: { location: "/auth/login", "cache-control": "no-store" } });
    const users = await ctx.fns.auth.listUsers({});
    const lone = users.length === 1 ? users[0]! : null;
    if (users.length > 1 || (lone && lone.configuredAt != null)) return new Response("Setup already completed", { status: 409 });
    if (!lone && (await ctx.fns.auth.password({}))) return new Response("Switch this install with: bun script/multiuser.ts up", { status: 409 });
    const form = await opts.req.formData();
    const back = (error: string) => new Response(null, { status: 303, headers: { location: `/auth/setup?error=${encodeURIComponent(error)}`, "cache-control": "no-store" } });
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim() || null;
    const password = String(form.get("password") ?? "") || null;

    let user: types.auth.User;
    try {
        if (lone) {
            if (lone.hasPassword) {
                const ok = await ctx.fns.auth.verifyUser({ password: String(form.get("current") ?? "") });
                if (!ok) { await Bun.sleep(250); return back("Current password is incorrect."); }
            }
            user = await ctx.fns.auth.updateUser({ id: lone.id, name, email, ...(password ? { password } : {}), configured: true });
        } else {
            user = await ctx.fns.auth.createUser({ name, email, password, role: "owner" });
        }
    } catch (e) {
        return back(String((e as Error).message).replace(/^auth\.\w+: /, ""));
    }
    const headers: Record<string, string> = { "cache-control": "no-store", location: "/" };
    if (user.hasPassword) headers["set-cookie"] = await ctx.fns.auth.issueSession({ user, req: opts.req });
    return new Response(null, { status: 303, headers });
}
