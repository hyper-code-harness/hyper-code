/** Durable generic delivery receipts survive transcript clear/truncate; target deletion removes them. */
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `CREATE TABLE IF NOT EXISTS session_notification_receipts (
            agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            delivery_key TEXT NOT NULL,
            payload TEXT NOT NULL,
            message_idx INTEGER NOT NULL,
            event_idx INTEGER NOT NULL,
            transport_actor TEXT NOT NULL,
            created_at BIGINT NOT NULL,
            PRIMARY KEY(agent_id, delivery_key)
        )` });
    },
};
