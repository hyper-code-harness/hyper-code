/** Adds function tags (`@view`, `@live <topic>`, …) to the function index so search can filter by them. */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: `
        ALTER TABLE functions ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '{}'::jsonb;
        CREATE INDEX IF NOT EXISTS functions_tags ON functions USING gin (tags);
    ` }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: `
        DROP INDEX IF EXISTS functions_tags;
        ALTER TABLE functions DROP COLUMN IF EXISTS tags;
    ` }); },
};
