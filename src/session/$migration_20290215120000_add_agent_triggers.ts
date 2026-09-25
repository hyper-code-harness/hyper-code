const upSql = `
CREATE TABLE agent_triggers (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('at', 'cron', 'watch')),
  prompt TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  timezone TEXT,
  mode TEXT NOT NULL DEFAULT 'once' CHECK (mode IN ('once', 'edge', 'repeat')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'checking', 'completed', 'timed_out', 'cancelled')),
  next_at BIGINT,
  timeout_at BIGINT,
  last_ready BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at BIGINT,
  last_error TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  finished_at BIGINT
);
CREATE INDEX agent_triggers_due_idx ON agent_triggers(next_at, id) WHERE status = 'active';
CREATE INDEX agent_triggers_agent_idx ON agent_triggers(agent_id, created_at DESC);

CREATE TABLE agent_trigger_runs (
  id BIGSERIAL PRIMARY KEY,
  trigger_id TEXT NOT NULL REFERENCES agent_triggers(id) ON DELETE CASCADE,
  scheduled_at BIGINT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('fired', 'waiting', 'rearmed', 'timed_out', 'error')),
  result JSONB,
  error TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE(trigger_id, scheduled_at, outcome)
);
CREATE INDEX agent_trigger_runs_trigger_idx ON agent_trigger_runs(trigger_id, id DESC);
`;

export default {
  up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
  down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS agent_trigger_runs; DROP TABLE IF EXISTS agent_triggers;" }); },
};
