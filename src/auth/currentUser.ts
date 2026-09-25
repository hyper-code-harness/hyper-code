/**
 * Resolves who is making a request.
 *
 * - no users yet, or a single user without a password: sign-in is not required; returns that
 *   user (or null when there are no users), matching today's open local instance;
 * - otherwise: a valid session cookie for an active user is required, and the users row is
 *   re-read on every call so a disabled user is rejected immediately.
 * The result's `required` says whether an anonymous request must be turned away.
 * @param opts.req Incoming HTTP request carrying the session cookie.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request carrying the session cookie. */
        req: Request;
    },
): Promise<{ user: types.auth.User | null; required: boolean }> {
    const users = await ctx.fns.auth.listUsers({});
    if (users.length === 0) return { user: null, required: false };
    if (users.length === 1 && !users[0]!.hasPassword) return { user: users[0]!, required: false };
    const claims: any = await ctx.fns.procs.auth.authenticate({ req: opts.req });
    const user = claims?.sub ? await ctx.fns.auth.getUser({ id: String(claims.sub) }) : null;
    return { user, required: true };
}
