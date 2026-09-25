/**
 * Lists users without password hashes, oldest first.
 *
 * The count of active users decides single versus multiuser behavior. Use for the users page,
 * the sign-in form, and to check whether the instance still needs setup.
 * @param opts.includeDisabled Include disabled users. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Include disabled users. @default false */
        includeDisabled?: boolean;
    },
): Promise<types.auth.User[]> {
    const where = opts?.includeDisabled ? "" : "WHERE disabled_at IS NULL";
    const rows = await ctx.fns.procs.db.select({ sql: `SELECT * FROM users ${where} ORDER BY created_at, id` }) as any[];
    return rows.map((row) => ctx.fns.auth.row({ row }));
}
