/**
 * Checks sign-in credentials and returns the matching active user, or null.
 *
 * With one active user, the email may be omitted and only the password is checked, so a
 * single-user install keeps its password-only sign-in. With more users, email is required.
 * Returns null for any failure without saying which part was wrong.
 * @param opts.email Sign-in email; optional only when there is a single user.
 * @param opts.password Candidate plain password.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Sign-in email; optional only when there is a single user. */
        email?: string | null;
        /** Candidate plain password. */
        password: string;
    },
): Promise<types.auth.User | null> {
    if (!opts.password) return null;
    const email = opts.email ? String(opts.email).trim().toLowerCase() : "";
    let rows: any[];
    if (email) {
        rows = await ctx.fns.procs.db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE lower(u.email) = ? AND u.disabled_at IS NULL", params: [email] }) as any[];
    } else {
        rows = await ctx.fns.procs.db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE u.disabled_at IS NULL LIMIT 2" }) as any[];
        if (rows.length !== 1) return null;
    }
    const row = rows[0];
    if (!row?.password_hash) return null;
    const ok = await Bun.password.verify(opts.password, String(row.password_hash)).catch(() => false);
    return ok ? ctx.fns.auth.row({ row }) : null;
}
