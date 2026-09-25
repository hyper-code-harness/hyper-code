/** Split pre-retrieval gate from rerank without changing existing agents' behavior. */
export default {
    async up(ctx: Context) {
        await ctx.fns.procs.db.exec({ sql: `ALTER TABLE agents ADD COLUMN function_rag_gate_enabled BOOLEAN NOT NULL DEFAULT FALSE;
            UPDATE agents SET function_rag_gate_enabled = jev_rerank_enabled;` });
    },
};
