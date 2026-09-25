/** Returns the current user for native clients and the UI, plus whether sign-in is required. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const { user, required } = await ctx.fns.auth.currentUser({ req: opts.req });
    const users = await ctx.fns.auth.listUsers({});
    if (!user && required) return Response.json({ authenticated: false, multiuser: users.length > 1 }, { status: 401 });
    return Response.json({ authenticated: !!user, required, multiuser: users.length > 1, user });
}
