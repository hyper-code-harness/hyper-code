// Canvas tabs keep their arguments in payload and their own small state (scroll, selection, edits…) here,
// so it survives reloads and the agent sees it. Additive.
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb" }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_items DROP COLUMN IF EXISTS state" }); },
};
