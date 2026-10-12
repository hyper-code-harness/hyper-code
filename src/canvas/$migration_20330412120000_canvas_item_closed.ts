// Closing a tab marks it instead of deleting it, so a closed tab (with its args and state) can be found and
// reopened. Closed rows older than 30 days are purged on the next close. Additive.
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS closed_at BIGINT;
CREATE INDEX IF NOT EXISTS canvas_items_closed_idx ON canvas_items (agent_id, closed_at DESC) WHERE closed_at IS NOT NULL;` });
    },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "DROP INDEX IF EXISTS canvas_items_closed_idx; DELETE FROM canvas_items WHERE closed_at IS NOT NULL; ALTER TABLE canvas_items DROP COLUMN IF EXISTS closed_at" });
    },
};
