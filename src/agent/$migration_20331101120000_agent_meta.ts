// agents.meta — free-form JSON a plugin keeps on a chat (a profile, a role, which
// base prompt to answer agent.basePrompt with). Core never reads inside it.
// Idempotent and matching the column already present on live instances
// (jsonb NOT NULL DEFAULT '{}'); '{}' reads back as "no meta".
const upSql = `ALTER TABLE agents ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    // No down: the column predates this migration on live instances; dropping it would lose data it did not create.
};
