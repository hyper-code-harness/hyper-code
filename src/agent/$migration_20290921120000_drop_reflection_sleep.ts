// Reflection and idle sleep were removed: the background passes that wrote
// these columns no longer exist, so the columns are dead weight on every agent
// row. sleep_context stays — manual and automatic compaction still use it.
/** Drops the reflection state and the reflection/sleep automation flags. */
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents DROP COLUMN IF EXISTS reflection" });
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents DROP COLUMN IF EXISTS reflection_enabled" });
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents DROP COLUMN IF EXISTS sleep_enabled" });
    },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents ADD COLUMN reflection JSONB" });
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents ADD COLUMN reflection_enabled BOOLEAN NOT NULL DEFAULT FALSE" });
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents ADD COLUMN sleep_enabled BOOLEAN NOT NULL DEFAULT FALSE" });
    },
};
