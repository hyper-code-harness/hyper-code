// Agent memory index: one row per memory entry. type=file|code entries point at a file under
// the project's <defaultDir>/.hyper/memory/ (url is relative to defaultDir); type=jsonb entries
// keep their content in data. visibility says who sees it: global, project, or session (one agent).
const upSql = `
CREATE TABLE IF NOT EXISTS memory (
    id          BIGSERIAL PRIMARY KEY,
    visibility  TEXT NOT NULL CHECK (visibility IN ('global', 'project', 'session')),
    project_id  TEXT REFERENCES projects(id) ON DELETE CASCADE,
    agent_id    TEXT,
    key         TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('file', 'code', 'jsonb')),
    kind        TEXT,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    url         TEXT,
    meta        JSONB NOT NULL DEFAULT '{}',
    data        JSONB,
    created_by  TEXT,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    CHECK (visibility <> 'project' OR project_id IS NOT NULL),
    CHECK (visibility <> 'session' OR agent_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_scope_key_idx
    ON memory (visibility, COALESCE(project_id, ''), COALESCE(agent_id, ''), key);
CREATE INDEX IF NOT EXISTS memory_project_idx ON memory (project_id);
CREATE INDEX IF NOT EXISTS memory_agent_idx ON memory (agent_id) WHERE agent_id IS NOT NULL;
`;

const downSql = `DROP TABLE IF EXISTS memory;`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
