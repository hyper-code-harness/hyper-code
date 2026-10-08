const upSql = `
CREATE SCHEMA IF NOT EXISTS inbox;

CREATE TABLE IF NOT EXISTS inbox.messages (
    id text NOT NULL,
    direction text NOT NULL,
    agent_id text,
    from_addr text NOT NULL,
    to_addrs jsonb NOT NULL DEFAULT '[]',
    subject text,
    body text NOT NULL,
    thread text,
    hop integer NOT NULL DEFAULT 0,
    verified boolean NOT NULL,
    reason text,
    sender_principal text,
    seq bigint,
    created_at bigint NOT NULL,
    received_at bigint NOT NULL,
    delivered_at bigint,
    read_at bigint,
    PRIMARY KEY (id, direction),
    CONSTRAINT inbox_direction_check CHECK (direction IN ('in', 'out'))
);
CREATE INDEX IF NOT EXISTS inbox_messages_received_idx ON inbox.messages(received_at DESC);
CREATE INDEX IF NOT EXISTS inbox_messages_agent_idx ON inbox.messages(agent_id, received_at DESC);
CREATE INDEX IF NOT EXISTS inbox_messages_thread_idx ON inbox.messages(thread);

CREATE TABLE IF NOT EXISTS inbox.aliases (
    name text PRIMARY KEY,
    agent_id text NOT NULL,
    created_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox.state (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at bigint NOT NULL
);
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP SCHEMA IF EXISTS inbox CASCADE" }); },
};
