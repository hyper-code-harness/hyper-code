// Inputs: a question the agent asks the person as a live form inside the chat
// (a secret, a confirmation, a choice, a pick from a grid). One row per form;
// the chat event only points at it, so the bubble renders whatever state the
// row is in — open while waiting, the answer once submitted. Additive.
const upSql = `
CREATE TABLE IF NOT EXISTS inputs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    spec JSONB NOT NULL DEFAULT '{}'::jsonb,
    result JSONB,
    error TEXT,
    answered_by TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS inputs_agent_idx ON inputs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inputs_open_idx ON inputs (agent_id) WHERE state = 'open';
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS inputs" }); },
};
