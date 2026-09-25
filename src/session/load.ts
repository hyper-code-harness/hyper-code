/** Load for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string }): Promise<types.agent.Agent | null> {
    const { id } = opts;
    const rows = (await ctx.fns.procs.db.select({ sql: 'SELECT * FROM agents WHERE id = ? AND archived_at IS NULL', params: [id] })) as any[];
    const row = rows[0];
    if (!row) return null;

    const agent: types.agent.Agent = {
        id: row.id,
        model: row.model,
        title: row.title ?? "",
        reasoningEffort: row.reasoning_effort || "auto",
        workspaceDir: row.workspace_dir || process.cwd(),
        systemPrompt: row.system_prompt,
        tools: row.tools == null ? undefined : (typeof row.tools === 'string' ? JSON.parse(row.tools) : row.tools),
        scratchpad: JSON.parse(row.scratchpad),
        messages: [],
        statusLine: row.status_line ?? "",
        statusLineMode: row.status_line_mode === "custom" || row.status_line_mode === "off" ? row.status_line_mode : "global",
        statusLineEvery: Math.max(1, Number(row.status_line_every ?? 1)),
        events: [],
        sleepContext: row.sleep_context == null ? null : (typeof row.sleep_context === 'string' ? JSON.parse(row.sleep_context) : row.sleep_context),
        cursors: {},
        functionRagEnabled: row.function_rag_enabled === true || row.function_rag_enabled === 1 || row.function_rag_enabled === 't',
        jevRerankEnabled: row.jev_rerank_enabled === true || row.jev_rerank_enabled === 1 || row.jev_rerank_enabled === 't',
        goal: row.goal == null ? null : (typeof row.goal === 'string' ? JSON.parse(row.goal) : row.goal),
        functionRagGateEnabled: row.function_rag_gate_enabled === true || row.function_rag_gate_enabled === 1 || row.function_rag_gate_enabled === 't',
        subscribers: new Set(),
        wakeAt: row.wake_at == null ? null : Number(row.wake_at),
        wakeReason: row.wake_reason == null ? null : String(row.wake_reason),
        waiters: [],
        isStreaming: false,
        abortController: null,
        parentId: row.parent_id ?? null,
        forkOffset: row.fork_offset ?? null,
        visibility: row.visibility === "team" || row.visibility === "hidden" ? row.visibility : "nav",
    };
    return await ctx.fns.session.syncAgentState({ agent });
}
