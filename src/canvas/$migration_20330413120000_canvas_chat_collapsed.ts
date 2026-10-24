// The chat beside an open canvas can be folded into a floating strip at the bottom (canvas.update chatCollapsed).
// Kept per chat next to open and chat_width. Additive.
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_state ADD COLUMN IF NOT EXISTS chat_collapsed BOOLEAN NOT NULL DEFAULT false" });
    },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_state DROP COLUMN IF EXISTS chat_collapsed" });
    },
};
