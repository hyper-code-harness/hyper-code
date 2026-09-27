// agents.workspace_host — SSH host alias the agent's workspace lives on.
// Empty means local; when set, agents.workspace_dir is a path on that host.
const up_sql = "ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace_host TEXT NOT NULL DEFAULT '';\n";

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: up_sql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents DROP COLUMN IF EXISTS workspace_host;\n" }); },
};
