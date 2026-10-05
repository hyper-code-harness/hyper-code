const upSql = `
DROP TRIGGER IF EXISTS events_update_agent_last_notifiable ON events;
DROP FUNCTION IF EXISTS update_agent_last_notifiable();
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
};
