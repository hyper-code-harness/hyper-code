/**
 * Maps a users table row to the public User shape, dropping the password hash.
 *
 * Internal helper for the auth module; every read of users goes through it so the hash never escapes.
 * @param opts.row Raw users row from the database.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Raw users row from the database. */
        row: Record<string, unknown>;
    },
): types.auth.User {
    const r = opts.row as any;
    return {
        id: String(r.id),
        email: r.email == null ? null : String(r.email),
        name: String(r.name),
        role: r.role === "owner" ? "owner" : "member",
        hasPassword: r.password_hash != null && String(r.password_hash) !== "",
        configuredAt: r.configured_at == null ? null : Number(r.configured_at),
        createdAt: Number(r.created_at),
        disabledAt: r.disabled_at == null ? null : Number(r.disabled_at),
    };
}
