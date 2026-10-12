const upSql = `
CREATE TABLE agent_attachments (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'detached')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  detached_at BIGINT
);
CREATE INDEX agent_attachments_source_idx ON agent_attachments(source, status);
CREATE INDEX agent_attachments_agent_idx ON agent_attachments(agent_id, created_at DESC);

CREATE TABLE attachment_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(source, event_id)
);
CREATE INDEX attachment_events_created_idx ON attachment_events(created_at DESC);

CREATE TABLE attachment_deliveries (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES attachment_events(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES agent_attachments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivering', 'delivered', 'failed')),
  claim_token TEXT,
  claimed_at BIGINT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  delivered_at BIGINT,
  UNIQUE(event_id, attachment_id)
);
CREATE INDEX attachment_deliveries_pending_idx ON attachment_deliveries(status, created_at);
`;

export default {
  up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
  down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS attachment_deliveries; DROP TABLE IF EXISTS attachment_events; DROP TABLE IF EXISTS agent_attachments;" }); },
};
