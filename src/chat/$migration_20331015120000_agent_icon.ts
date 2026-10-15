// The chat icon: sanitized SVG markup (≤ 8 KB) set by chat.setIcon; NULL shows the model logo.
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents ADD COLUMN IF NOT EXISTS icon TEXT" }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents DROP COLUMN IF EXISTS icon" }); },
};
