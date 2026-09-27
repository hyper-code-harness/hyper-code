// People who can sign in. One user = single-user Hyper; more = multiuser (DESIGN §34).
//
// Runs automatically at boot (procs/migrate $start), so it must be safe on a live, large
// database without anyone watching:
// - Additive only. Nothing is renamed or rewritten; history written before users existed
//   simply has no recorded author (NULL). No users are created here.
// - ADD COLUMN without a DEFAULT is a catalog-only change in Postgres 11+: no table rewrite.
// - It still takes a brief ACCESS EXCLUSIVE lock. `SET LOCAL lock_timeout` inside one
//   transaction makes it fail fast (and roll back entirely) instead of queueing behind a long
//   transaction; boot logs the error and the migration simply runs again on the next start.
// - One transaction on a reserved connection: all or nothing, and the timeout cannot leak into
//   the pool.
// - Converges an older shape of `users` (earlier drafts had NOT NULL email/password and no
//   configured_at) instead of silently accepting it.
// - `down` removes exactly what `up` added. The recommended rollback is to run the previous code
//   and leave this schema in place (old code ignores it); `down` is an optional cleanup.
const up_sql = [
    "SET LOCAL lock_timeout = '3s'",
    `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT,
        name TEXT NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        configured_at BIGINT,
        disabled_at BIGINT
    )`,
    "ALTER TABLE users ALTER COLUMN email DROP NOT NULL",
    "ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS configured_at BIGINT",
    "DROP INDEX IF EXISTS users_email_lower_idx",
    "CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email)) WHERE email IS NOT NULL",
    "ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_by TEXT",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS author TEXT",
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS actor TEXT",
];

const down_sql = [
    "SET LOCAL lock_timeout = '3s'",
    "ALTER TABLE events DROP COLUMN IF EXISTS actor",
    "ALTER TABLE messages DROP COLUMN IF EXISTS author",
    "ALTER TABLE agents DROP COLUMN IF EXISTS created_by",
    "DROP TABLE IF EXISTS users",
];

async function inTransaction(ctx: Context, statements: string[]) {
    const pool: any = await ctx.fns.procs.db.conn();
    await pool.begin(async (tx: any) => {
        for (const statement of statements) await tx.unsafe(statement);
    });
}

export default {
    up: async (ctx: Context) => { await inTransaction(ctx, up_sql); },
    down: async (ctx: Context) => { await inTransaction(ctx, down_sql); },
};
