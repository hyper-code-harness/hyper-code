// Canvas tabs can be pinned (canvas.pin): a pinned tab stays at the left of the strip as an icon, has no
// close button and is never put away for being unused. shown_at says when a tab was last the one shown: the
// least recently shown unpinned tabs are put away (closed, restorable) once the strip grows past
// canvas.maxTabs. Kept per tab. Additive.
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS pinned_at BIGINT; ALTER TABLE canvas_items ADD COLUMN IF NOT EXISTS shown_at BIGINT" });
    },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_items DROP COLUMN IF EXISTS pinned_at; ALTER TABLE canvas_items DROP COLUMN IF EXISTS shown_at" });
    },
};
