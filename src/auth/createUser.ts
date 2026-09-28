/**
 * Adds a person who can sign in; email and password are optional only for a lone first user.
 *
 * Stores an Argon2id hash, never the password. Once the instance has another user, a new user must
 * have both email and password, and so must the existing ones before anyone can tell them apart at sign-in.
 * The first user becomes owner unless a role is given.
 * @param opts.name Display name.
 * @param opts.email Sign-in email; unique regardless of case.
 * @param opts.password Plain password or an existing Argon2 hash; only a hash is stored.
 * @param opts.role Instance role. @default member, or owner for the first user
 * @param opts.configured Mark the user as confirmed at setup rather than seeded. @default true
 * @param opts.allowNoPassword Allow a new person without a password (they sign in with Google). Email is still required. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Display name. */
        name: string;
        /** Sign-in email; unique regardless of case. */
        email?: string | null;
        /** Plain password or an existing Argon2 hash; only a hash is stored. */
        password?: string | null;
        /** Instance role. @default member, or owner for the first user */
        role?: "owner" | "member";
        /** Mark the user as confirmed at setup rather than seeded. @default true */
        configured?: boolean;
        /** Allow a new person without a password (they sign in with Google). Email is still required. @default false */
        allowNoPassword?: boolean;
    },
): Promise<types.auth.User> {
    const name = String(opts.name ?? "").trim();
    const email = opts.email ? String(opts.email).trim().toLowerCase() : null;
    if (!name) throw new Error("auth.createUser: name is required");
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("auth.createUser: invalid email: " + email);

    const existing = await ctx.fns.auth.listUsers({});
    if (existing.length > 0) {
        if (!email || (!opts.password && !opts.allowNoPassword)) throw new Error("auth.createUser: with more than one user, email and password are required");
        const unnamed = existing.filter((u) => !u.email || !u.canSignIn);
        if (unnamed.length) throw new Error(`auth.createUser: set email and password for ${unnamed.map((u) => u.name).join(", ")} first`);
    }
    if (email) {
        const taken = await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM users WHERE lower(email) = ?", params: [email] }) as any[];
        if (taken.length) throw new Error("auth.createUser: email already in use: " + email);
    }
    if (opts.password && !opts.password.startsWith("$argon2") && opts.password.length < 8) {
        throw new Error("auth.createUser: password must be at least 8 characters");
    }

    const hash = !opts.password ? null
        : (opts.password.startsWith("$argon2") || opts.password.startsWith("$2")) ? opts.password
        : await Bun.password.hash(opts.password);
    const all = await ctx.fns.auth.listUsers({ includeDisabled: true });
    const role = opts.role ?? (all.length === 0 ? "owner" : "member");
    const id = await ctx.fns.auth.slug({ name, email });
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: "INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at, configured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [id, email, name, hash, role, now, now, opts.configured === false ? null : now],
    });
    const created = await ctx.fns.procs.db.select({ sql: "SELECT u.*, (SELECT count(*) FROM user_identities i WHERE i.user_id = u.id) AS identities FROM users u WHERE u.id = ?", params: [id] }) as any[];
    return ctx.fns.auth.row({ row: created[0] });
}
