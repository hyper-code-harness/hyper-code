// People who can sign in. One user = single-user Hyper; more = multiuser (DESIGN §34).
// email and password_hash are nullable: a lone user may have neither (local, no sign-in)
// or only a password (legacy shared-password install). configured_at marks a user whose
// name was confirmed at setup, as opposed to one seeded from env or the legacy password.
// Author columns on agents/messages/events are nullable and NOT backfilled: history
// written before users existed simply has no recorded author.
const up_sql = `
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
`;

const down_sql = `
ALTER TABLE events DROP COLUMN IF EXISTS actor;
ALTER TABLE messages DROP COLUMN IF EXISTS author;
ALTER TABLE agents DROP COLUMN IF EXISTS created_by;
DROP TABLE IF EXISTS users;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: up_sql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: down_sql }); },
};
