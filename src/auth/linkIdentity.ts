/**
 * Finds or creates the Hyper user for a verified external identity (Google or the OIDC control plane).
 *
 * Looks up the identity by Google's stable subject first. Otherwise links it to an existing active
 * user with the same email; otherwise, when auto-create is on, creates a member (the first user ever
 * becomes owner). Returns null when the account is not allowed to sign in.
 * @param opts.provider Identity provider key stored in user_identities, e.g. google or oidc.
 * @param opts.sub Provider subject (stable account id).
 * @param opts.email Verified email from the ID token.
 * @param opts.name Display name from the ID token.
 * @param opts.autoCreate Create a user on first sign-in when none matches. @default true
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Identity provider key stored in user_identities, e.g. google or oidc. */
        provider: string;
        /** Provider subject (stable account id). */
        sub: string;
        /** Verified email from the ID token. */
        email: string;
        /** Display name from the ID token. */
        name: string;
        /** Create a user on first sign-in when none matches. @default true */
        autoCreate?: boolean;
    },
): Promise<types.auth.User | null> {
    const db = ctx.fns.procs.db;
    const now = Date.now();
    const linked = await db.select({ sql: "SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?", params: [opts.provider, opts.sub] }) as any[];
    if (linked.length) {
        const user = await ctx.fns.auth.getUser({ id: linked[0].user_id });
        if (!user) return null;
        await db.run({ sql: "UPDATE user_identities SET last_login_at = ?, email = ? WHERE provider = ? AND subject = ?", params: [now, opts.email, opts.provider, opts.sub] });
        return user;
    }
    const byEmail = await db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE lower(u.email) = ?", params: [opts.email.toLowerCase()] }) as any[];
    let user: types.auth.User | null = null;
    if (byEmail.length) {
        user = ctx.fns.auth.row({ row: byEmail[0] });
        if (user.disabledAt != null) return null;
    } else if (opts.autoCreate !== false) {
        const all = await ctx.fns.auth.listUsers({ includeDisabled: true });
        // Google users need no password; createUser only requires email+password once several
        // users exist, so create directly with the verified email.
        const id = await ctx.fns.auth.slug({ name: opts.name, email: opts.email });
        await db.run({
            sql: "INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at, configured_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)",
            params: [id, opts.email.toLowerCase(), opts.name, all.length === 0 ? "owner" : "member", now, now, now],
        });
        user = await ctx.fns.auth.getUser({ id });
    }
    if (!user) return null;
    await db.run({
        sql: "INSERT INTO user_identities (provider, subject, user_id, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (provider, subject) DO NOTHING",
        params: [opts.provider, opts.sub, user.id, opts.email, now, now],
    });
    return user;
}
