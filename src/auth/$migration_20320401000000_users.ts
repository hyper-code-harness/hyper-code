// People who can sign in. One user = single-user Hyper; more = multiuser (DESIGN §34).
//
// Written to be safe on a live, large database:
// - Additive only. Nothing is renamed, dropped, rewritten or backfilled; history written before
//   users existed simply has no recorded author (NULL).
// - ADD COLUMN without a DEFAULT is a catalog-only change in Postgres 11+: no table rewrite,
//   instant regardless of table size.
// - It still needs a brief ACCESS EXCLUSIVE lock. `lock_timeout` makes the migration fail fast
//   instead of queueing behind a long transaction (and blocking every query queued after it);
//   just rerun it.
// - Idempotent (IF NOT EXISTS), so a partial or repeated run is harmless.
// - `down` removes exactly what `up` added. Dropping a column is also catalog-only.
// email and password_hash are nullable: a lone user may have neither (local, no sign-in) or
// only a password (legacy shared-password install). configured_at marks a user whose name was
// confirmed at setup, as opposed to one seeded from env or the legacy password.
const up_sql = `
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    configured_at BIGINT,
    disabled_at BIGINT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email)) WHERE email IS NOT NULL;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS author TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS actor TEXT;
RESET lock_timeout;
`;

const down_sql = `
SET lock_timeout = '3s';
ALTER TABLE events DROP COLUMN IF EXISTS actor;
ALTER TABLE messages DROP COLUMN IF EXISTS author;
ALTER TABLE agents DROP COLUMN IF EXISTS created_by;
DROP TABLE IF EXISTS users;
RESET lock_timeout;
`;

// Bun's pooled client rejects BEGIN/COMMIT, so no explicit transaction: every statement is
// atomic on its own and idempotent, so a run interrupted halfway is simply rerun.
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: up_sql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: down_sql }); },
};
