// Memory levels, as of the move to ~/.hyper: system (everyone), user (one person and all of their agents, in
// every project), project (its agents and people), agent (one agent). `global` becomes `system` and `session`
// becomes `agent`; user rows carry user_id. Files live under the instance's ~/.hyper/memory, not in a repo.
const upSql = `
ALTER TABLE memory ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS memory_visibility_check;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS memory_check1;
UPDATE memory SET visibility = 'system' WHERE visibility = 'global';
UPDATE memory SET visibility = 'agent' WHERE visibility = 'session';
ALTER TABLE memory ADD CONSTRAINT memory_visibility_check CHECK (visibility IN ('system', 'user', 'project', 'agent'));
ALTER TABLE memory ADD CONSTRAINT memory_agent_level_check CHECK (visibility <> 'agent' OR agent_id IS NOT NULL);
ALTER TABLE memory ADD CONSTRAINT memory_user_level_check CHECK (visibility <> 'user' OR user_id IS NOT NULL);
DROP INDEX IF EXISTS memory_scope_key_idx;
CREATE UNIQUE INDEX memory_scope_key_idx
    ON memory (visibility, COALESCE(project_id, ''), COALESCE(user_id, ''), COALESCE(agent_id, ''), key);
CREATE INDEX IF NOT EXISTS memory_user_idx ON memory (user_id) WHERE user_id IS NOT NULL;
`;

const downSql = `
DELETE FROM memory WHERE visibility = 'user';
ALTER TABLE memory DROP CONSTRAINT IF EXISTS memory_visibility_check;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS memory_agent_level_check;
ALTER TABLE memory DROP CONSTRAINT IF EXISTS memory_user_level_check;
UPDATE memory SET visibility = 'global' WHERE visibility = 'system';
UPDATE memory SET visibility = 'session' WHERE visibility = 'agent';
ALTER TABLE memory ADD CONSTRAINT memory_visibility_check CHECK (visibility IN ('global', 'project', 'session'));
ALTER TABLE memory ADD CONSTRAINT memory_check1 CHECK (visibility <> 'session' OR agent_id IS NOT NULL);
DROP INDEX IF EXISTS memory_scope_key_idx;
CREATE UNIQUE INDEX memory_scope_key_idx ON memory (visibility, COALESCE(project_id, ''), COALESCE(agent_id, ''), key);
DROP INDEX IF EXISTS memory_user_idx;
ALTER TABLE memory DROP COLUMN IF EXISTS user_id;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
