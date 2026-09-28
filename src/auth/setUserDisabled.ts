/**
 * Disables or re-enables a user; a disabled user loses access on their next request.
 *
 * Existing session cookies stop working immediately because authentication re-reads the users row.
 * Refuses to disable the last active owner. Data the user authored stays in place.
 * @param opts.id User id to change.
 * @param opts.disabled True to disable, false to re-enable.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** User id to change. */
        id: string;
        /** True to disable, false to re-enable. */
        disabled: boolean;
    },
): Promise<types.auth.User> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE u.id = ?", params: [opts.id] }) as any[];
    if (!rows.length) throw new Error("auth.setUserDisabled: no such user: " + opts.id);
    const user = ctx.fns.auth.row({ row: rows[0] });
    if (opts.disabled && user.role === "owner" && user.disabledAt == null) {
        const owners = (await ctx.fns.auth.listUsers({})).filter((u) => u.role === "owner");
        if (owners.length <= 1) throw new Error("auth.setUserDisabled: cannot disable the last active owner");
    }
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: "UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?",
        params: [opts.disabled ? (user.disabledAt ?? now) : null, now, opts.id],
    });
    const after = await ctx.fns.procs.db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE u.id = ?", params: [opts.id] }) as any[];
    return ctx.fns.auth.row({ row: after[0] });
}
