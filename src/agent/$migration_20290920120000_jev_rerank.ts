/** Adds the opt-in per-agent Jev reranking flag for function RAG. */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents ADD COLUMN jev_rerank_enabled BOOLEAN NOT NULL DEFAULT FALSE" }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "ALTER TABLE agents DROP COLUMN jev_rerank_enabled" }); },
};
