/** Persist independent retrieval, pre-retrieval gate and rerank toggles without changing omitted settings. */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Identifier of the non-archived agent to update. */
    id: string;
    /** Master switch for the entire function retrieval pipeline. */
    functionRagEnabled?: boolean;
    /** Enable the heuristic pre-retrieval gate independently of reranking. */
    functionRagGateEnabled?: boolean;
    /** Enable candidate reranking independently of the gate. */
    jevRerankEnabled?: boolean;
}): Promise<{ functionRagEnabled: boolean; functionRagGateEnabled: boolean; jevRerankEnabled: boolean }> {
    const row = (await ctx.fns.procs.db.select({ sql: 'SELECT function_rag_enabled, function_rag_gate_enabled, jev_rerank_enabled FROM agents WHERE id = ? AND archived_at IS NULL', params: [opts.id] }))[0];
    if (!row) throw new Error(`agent not found: ${opts.id}`);
    const enabled = (value: unknown) => value === true || value === 1 || value === 't';
    const flags = {
        functionRagEnabled: opts.functionRagEnabled ?? enabled(row.function_rag_enabled),
        functionRagGateEnabled: opts.functionRagGateEnabled ?? enabled(row.function_rag_gate_enabled),
        jevRerankEnabled: opts.jevRerankEnabled ?? enabled(row.jev_rerank_enabled),
    };
    await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET function_rag_enabled = ?, function_rag_gate_enabled = ?, jev_rerank_enabled = ?, updated_at = ? WHERE id = ?', params: [flags.functionRagEnabled, flags.functionRagGateEnabled, flags.jevRerankEnabled, Date.now(), opts.id] });
    const live = ctx.state.agent?.[opts.id];
    if (live) Object.assign(live, flags);
    ctx.fns.events.refreshAgentMeta({ agentId: opts.id, section: 'automation', reason: 'automation' });
    return flags;
}
