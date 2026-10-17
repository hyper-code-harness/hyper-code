// Project slug: the stable, readable name used for the project's function namespace
// (ctx.fns.project_<slug>.<fn>) and folder (<defaultDir>/.hyper/src/project_<slug>/).
// Set once at creation; renaming it would break calls and links, so title is what changes.
const upSql = `
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug TEXT;
UPDATE projects SET slug = id WHERE slug IS NULL;
ALTER TABLE projects ALTER COLUMN slug SET NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_slug_format;
ALTER TABLE projects ADD CONSTRAINT projects_slug_format CHECK (slug ~ '^[a-z][A-Za-z0-9]{0,62}$');
CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_idx ON projects(slug);
`;

const downSql = `
DROP INDEX IF EXISTS projects_slug_idx;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_slug_format;
ALTER TABLE projects DROP COLUMN IF EXISTS slug;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
