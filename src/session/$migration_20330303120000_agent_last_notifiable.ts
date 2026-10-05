const upSql = `
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_notifiable_at BIGINT;

WITH latest AS (
    SELECT agent_id, MAX(ts) AS ts
    FROM events
    WHERE type IN ('assistant', 'error')
    GROUP BY agent_id
)
UPDATE agents a SET last_notifiable_at = latest.ts
FROM latest WHERE latest.agent_id = a.id;
`;

const downSql = `
ALTER TABLE agents DROP COLUMN IF EXISTS last_notifiable_at;
`;

export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: downSql }); },
};
