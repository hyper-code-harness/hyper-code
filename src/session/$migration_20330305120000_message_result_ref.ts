/** Add immutable tool-result metadata without rewriting messages or scratchpads. */
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: "ALTER TABLE messages ADD COLUMN IF NOT EXISTS result_ref JSONB" });
    },
};
