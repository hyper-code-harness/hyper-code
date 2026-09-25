/**
 * Resolves who is making a request.
 *
 * - no users yet: behaves exactly like before users existed — open when no shared password is
 *   configured, otherwise the legacy shared-password session is required (so deploying this code
 *   before switching an install over never changes sign-in);
 * - a single user without a password: open; that user is the author of everything;
 * - otherwise: a valid session cookie for an active user is required, and the users row is
 *   re-read on every call so a disabled user is rejected immediately.
 * `required` says whether an anonymous request must be turned away.
 * @param opts.req Incoming HTTP request carrying the session cookie.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request carrying the session cookie. */
        req: Request;
    },
): Promise<{ user: types.auth.User | null; required: boolean; legacy?: boolean }> {
    const users = await ctx.fns.auth.listUsers({});
    if (users.length === 0) {
        if (!(await ctx.fns.auth.password({}))) return { user: null, required: false };
        // Legacy shared-password install not switched over yet: a valid legacy session is enough.
        // `required` stays true so the middleware still applies its cross-origin write check.
        const claims: any = await ctx.fns.procs.auth.authenticate({ req: opts.req });
        return { user: null, required: true, legacy: !!claims };
    }
    if (users.length === 1 && !users[0]!.hasPassword) return { user: users[0]!, required: false };
    const claims: any = await ctx.fns.procs.auth.authenticate({ req: opts.req });
    const user = claims?.sub ? await ctx.fns.auth.getUser({ id: String(claims.sub) }) : null;
    return { user, required: true };
}
