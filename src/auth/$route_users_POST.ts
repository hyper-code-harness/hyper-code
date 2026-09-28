/**
 * Handles the People page forms (owners only): add a person, disable/enable, change role, and
 * edit your own name, email and password. Redirects back with a short result message.
 */
export default async function (ctx: Context, session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const me = (session as any)?.user as types.auth.User | undefined;
    if (!me || me.role !== "owner") return new Response("Only owners can manage people", { status: 403 });
    const form = await opts.req.formData();
    const get = (k: string) => String(form.get(k) ?? "").trim();
    const back = (key: "ok" | "error", message: string) =>
        new Response(null, { status: 303, headers: { location: `/auth/users?${key}=${encodeURIComponent(message)}`, "cache-control": "no-store" } });
    try {
        switch (get("action")) {
            case "add": {
                const google = await ctx.fns.auth.googleConfig({});
                const password = get("password") || null;
                if (!password && !google) return back("error", "Password is required (Google sign-in is off)");
                // With Google on, a person may be added without a password: they sign in with Google.
                const user = password
                    ? await ctx.fns.auth.createUser({ name: get("name"), email: get("email"), password })
                    : await ctx.fns.auth.createUser({ name: get("name"), email: get("email"), password: null, allowNoPassword: true });
                return back("ok", `Added ${user.name}`);
            }
            case "disable": await ctx.fns.auth.setUserDisabled({ id: get("id"), disabled: true }); return back("ok", "Disabled");
            case "enable": await ctx.fns.auth.setUserDisabled({ id: get("id"), disabled: false }); return back("ok", "Enabled");
            case "role": await ctx.fns.auth.updateUser({ id: get("id"), role: get("role") === "owner" ? "owner" : "member" }); return back("ok", "Role changed");
            case "me": {
                await ctx.fns.auth.updateUser({ id: me.id, name: get("name"), email: get("email") || null, ...(get("password") ? { password: get("password") } : {}) });
                return back("ok", "Saved");
            }
            default: return back("error", "Unknown action");
        }
    } catch (e) {
        return back("error", String((e as Error).message).replace(/^auth\.\w+: /, ""));
    }
}
