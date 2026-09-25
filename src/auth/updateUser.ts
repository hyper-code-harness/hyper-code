/**
 * Changes a user's name, email, password or role; the id never changes.
 *
 * Renaming keeps every recorded author intact because data references the id.
 * Refuses to demote the last active owner. Pass only the fields to change.
 * @param opts.id User id to change.
 * @param opts.name New display name.
 * @param opts.email New sign-in email; null clears it while the user is alone.
 * @param opts.password New plain password; only its hash is stored.
 * @param opts.role New instance role.
 * @param opts.configured Mark the user as confirmed at setup.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** User id to change. */
        id: string;
        /** New display name. */
        name?: string;
        /** New sign-in email; null clears it while the user is alone. */
        email?: string | null;
        /** New plain password; only its hash is stored. */
        password?: string;
        /** New instance role. */
        role?: "owner" | "member";
        /** Mark the user as confirmed at setup. */
        configured?: boolean;
    },
): Promise<types.auth.User> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT * FROM users WHERE id = ?", params: [opts.id] }) as any[];
    if (!rows.length) throw new Error("auth.updateUser: no such user: " + opts.id);
    const current = ctx.fns.auth.row({ row: rows[0] });
    const active = await ctx.fns.auth.listUsers({});
    const sets: string[] = [];
    const params: unknown[] = [];

    if (opts.name !== undefined) {
        const name = String(opts.name).trim();
        if (!name) throw new Error("auth.updateUser: name cannot be empty");
        sets.push("name = ?"); params.push(name);
    }
    if (opts.email !== undefined) {
        const email = opts.email ? String(opts.email).trim().toLowerCase() : null;
        if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("auth.updateUser: invalid email: " + email);
        if (!email && active.length > 1) throw new Error("auth.updateUser: email is required when there is more than one user");
        if (email) {
            const taken = await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM users WHERE lower(email) = ? AND id <> ?", params: [email, opts.id] }) as any[];
            if (taken.length) throw new Error("auth.updateUser: email already in use: " + email);
        }
        sets.push("email = ?"); params.push(email);
    }
    if (opts.password !== undefined) {
        if (opts.password.length < 8) throw new Error("auth.updateUser: password must be at least 8 characters");
        sets.push("password_hash = ?"); params.push(await Bun.password.hash(opts.password));
    }
    if (opts.role !== undefined && opts.role !== current.role) {
        if (current.role === "owner" && active.filter((u) => u.role === "owner").length <= 1) {
            throw new Error("auth.updateUser: cannot demote the last active owner");
        }
        sets.push("role = ?"); params.push(opts.role === "owner" ? "owner" : "member");
    }
    if (opts.configured) { sets.push("configured_at = COALESCE(configured_at, ?)"); params.push(Date.now()); }

    if (sets.length) {
        sets.push("updated_at = ?"); params.push(Date.now());
        await ctx.fns.procs.db.run({ sql: `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params: [...params, opts.id] });
    }
    const after = await ctx.fns.procs.db.select({ sql: "SELECT * FROM users WHERE id = ?", params: [opts.id] }) as any[];
    return ctx.fns.auth.row({ row: after[0] });
}
