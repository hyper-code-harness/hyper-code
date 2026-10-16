/** Add immutable predicate result references without modifying existing trigger history. */
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({sql: "ALTER TABLE agent_trigger_runs ADD COLUMN IF NOT EXISTS result_ref JSONB"});
    },
};
