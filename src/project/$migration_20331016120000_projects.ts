// Projects: a named unit of work that agents can belong to. Ids use the same short base-26
// form as agent sessions. default_dir/default_host say where the project's files live
// (memory, project functions); an agent may optionally point at one project.
const upSql = `
CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL DEFAULT '',
    default_dir  TEXT,
    default_host TEXT NOT NULL DEFAULT '',
    created_by   TEXT,
    created_at   BIGINT NOT NULL,
    updated_at   BIGINT NOT NULL,
    archived_at  BIGINT
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS agents_project_id_idx ON agents(project_id) WHERE project_id IS NOT NULL;
`;

const downSql = `
DROP INDEX IF EXISTS agents_project_id_idx;
ALTER TABLE agents DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS projects;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
