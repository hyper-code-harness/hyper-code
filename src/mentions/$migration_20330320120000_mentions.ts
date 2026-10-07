// @mentions of people in chats. One row per mentioned person per message; read_at stays NULL until
// that person opens the chat (or reads the mention explicitly). Additive: a new table, nothing rewritten.
const upSql = `
CREATE TABLE IF NOT EXISTS mentions (
    id BIGSERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    message_idx INTEGER NOT NULL,
    from_actor TEXT,
    to_user TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    read_at BIGINT,
    UNIQUE (agent_id, message_idx, to_user)
);
CREATE INDEX IF NOT EXISTS mentions_unread_idx ON mentions (to_user, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS mentions_to_user_idx ON mentions (to_user, created_at DESC);
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS mentions" }); },
};
