/** Create or update the agent's settings and durable state, including scratchpad and plans. Never writes messages or events: use session.appendMessage/appendEvent for new history and session.replaceMessages/replaceEvents for explicit imports or replacements. Safe to call with a stale in-memory transcript. */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Live agent instance to operate on. */
agent: types.agent.Agent }): Promise<void> {
    const { agent } = opts;
    const now = Date.now();
    // Owner is set once, on the first save, never changed later (not in ON CONFLICT).
    // A derived chat (fork, delegated child) belongs to the owner of its parent, not to whoever
    // happened to trigger it; a new top-level chat belongs to the person creating it.
    if (agent.createdBy === undefined) {
        const parentOwner = agent.parentId
            ? ((await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [agent.parentId] })) as any[])[0]?.created_by ?? null
            : null;
        agent.createdBy = parentOwner ?? await ctx.fns.auth.actorId({});
    }
    await ctx.fns.procs.db.run({
        sql: `
        INSERT INTO agents (id, title, workspace_dir, workspace_host, model, reasoning_effort, system_prompt, system_prompt_name, system_prompt_core, tools, scratchpad, sleep_context, goal, function_rag_enabled, jev_rerank_enabled, function_rag_gate_enabled, status_line, status_line_every, status_line_mode, parent_id, visibility, fork_offset, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM agents WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
            model = excluded.model,
            title = excluded.title,
            reasoning_effort = excluded.reasoning_effort,
            workspace_dir = excluded.workspace_dir,
            workspace_host = excluded.workspace_host,
            system_prompt = excluded.system_prompt,
            system_prompt_name = excluded.system_prompt_name,
            system_prompt_core = excluded.system_prompt_core,
            tools = excluded.tools,
            scratchpad = excluded.scratchpad,
            parent_id = excluded.parent_id,
            visibility = excluded.visibility,
            fork_offset = excluded.fork_offset,
            sleep_context = excluded.sleep_context,
            goal = excluded.goal,
            function_rag_enabled = excluded.function_rag_enabled,
            jev_rerank_enabled = excluded.jev_rerank_enabled,
            function_rag_gate_enabled = excluded.function_rag_gate_enabled,
            status_line = excluded.status_line,
            status_line_every = excluded.status_line_every,
            status_line_mode = excluded.status_line_mode,
            updated_at = excluded.updated_at
    `,
        params: [
            agent.id,
            agent.title ?? "",
            agent.workspaceDir || process.cwd(),
            agent.workspaceHost ?? "",
            agent.model,
            agent.reasoningEffort ?? "auto",
            agent.systemPrompt,
            agent.systemPromptName ?? "",
            agent.systemPromptCore ?? "",
            agent.tools?.length ? JSON.stringify(agent.tools) : null,
            JSON.stringify(agent.scratchpad ?? {}),
            agent.sleepContext == null ? null : JSON.stringify(agent.sleepContext),
            agent.goal == null ? null : JSON.stringify(agent.goal),
            agent.functionRagEnabled === true,
            agent.jevRerankEnabled === true,
            agent.functionRagGateEnabled === true,
            agent.statusLine ?? "",
            Math.max(1, Number(agent.statusLineEvery ?? 1)),
            agent.statusLineMode ?? "global",
            agent.parentId ?? null,
            agent.visibility ?? "nav",
            agent.forkOffset ?? null,
            agent.createdBy ?? null,
            agent.id,
            now,
            now,
        ],
    });

}
