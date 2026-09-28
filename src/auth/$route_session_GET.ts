/**
 * Returns the current user for native clients and the UI, plus whether sign-in is required.
 * Before the install is switched to users, a valid legacy shared-password session counts as
 * signed in, so existing clients do not appear logged out.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const { user, required, legacy } = await ctx.fns.auth.currentUser({ req: opts.req });
    const users = await ctx.fns.auth.listUsers({});
    const multiuser = users.length > 1;
    if (legacy) return Response.json({ authenticated: true, required, multiuser, user: { name: "Hyper user", role: "owner" } });
    if (!user && required) return Response.json({ authenticated: false, multiuser }, { status: 401 });
    return Response.json({ authenticated: !!user, required, multiuser, user });
}
