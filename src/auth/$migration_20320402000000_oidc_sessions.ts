// Server-side sign-in sessions for OIDC (Hyper Control Plane). The browser only ever holds a short
// signed cookie with the session id; the control plane's refresh token lives here, encrypted, and
// is used to silently renew the session (Backend-for-Frontend pattern). Additive and idempotent;
// nothing reads this table unless OIDC sign-in is configured.
const up_sql = [
    "SET LOCAL lock_timeout = '3s'",
    `CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        refresh_enc TEXT,
        created_at BIGINT NOT NULL,
        refreshed_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        revoked_at BIGINT
    )`,
    "CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id)",
];
const down_sql = ["SET LOCAL lock_timeout = '3s'", "DROP TABLE IF EXISTS auth_sessions"];

async function inTransaction(ctx: Context, statements: string[]) {
    const pool: any = await ctx.fns.procs.db.conn();
    await pool.begin(async (tx: any) => { for (const s of statements) await tx.unsafe(s); });
}

export default {
    up: async (ctx: Context) => { await inTransaction(ctx, up_sql); },
    down: async (ctx: Context) => { await inTransaction(ctx, down_sql); },
};
