/**
 * Loads one active user by id, or null when the user is missing or disabled.
 *
 * Used on every authenticated request so that disabling a user takes effect immediately.
 * @param opts.id User id carried in the session token subject.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** User id carried in the session token subject. */
        id: string;
    },
): Promise<types.auth.User | null> {
    if (!opts.id) return null;
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE u.id = ? AND u.disabled_at IS NULL", params: [opts.id] }) as any[];
    return rows[0] ? ctx.fns.auth.row({ row: rows[0] }) : null;
}
