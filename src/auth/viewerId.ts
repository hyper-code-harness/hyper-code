/**
 * Returns the id of the person looking at the UI in this request, or null.
 *
 * Unlike auth.actorId there is no fallback to a chat's creator: read state and pins belong to the
 * viewer, and background work has no viewer. With a single user and no session (open local
 * instance), that user is the viewer.
 */
export default async function (ctx: Context, session: Session | null, _opts: {}): Promise<string | null> {
    const fromSession = (session as any)?.user?.id;
    if (fromSession) return String(fromSession);
    const users = await ctx.fns.auth.listUsers({});
    return users.length === 1 && !users[0]!.canSignIn ? users[0]!.id : null;
}
