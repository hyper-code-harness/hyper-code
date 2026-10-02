const upSql = `
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_agent_client_request
ON messages(agent_id, client_request_id)
WHERE client_request_id IS NOT NULL;
`;

const downSql = `
DROP INDEX IF EXISTS idx_messages_agent_client_request;
ALTER TABLE messages DROP COLUMN IF EXISTS client_request_id;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
