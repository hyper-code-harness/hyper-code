/**
 * Compacts an oversized idle Codex agent after a successful turn
 *
 * Estimate the effective Codex context after a completed run and invoke native server compaction when it exceeds the configured token threshold. Skip non-Codex, running, already compacted, or too-small agents; failures are recorded as events but do not fail the completed user turn.
 * @param opts.agent Live agent to inspect after its run has finalized.
 * @param opts.thresholdTokens Estimated-token threshold overriding the global setting. @minimum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live agent to inspect after its run has finalized. */
        agent: types.agent.Agent;
        /** Estimated-token threshold overriding the global setting. @minimum 10000 */
        thresholdTokens?: number;
    },
): Promise<{ status: "compacted" | "below_threshold" | "not_codex" | "already_compact" | "busy" | "failed"; estimatedTokens: number; error?: string }> {
    const agent = opts.agent;
    const estimate = (messages: any[]) => Math.ceil(messages.reduce((n: number, m: any) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length) + JSON.stringify(m.tool_calls ?? []).length, 0) / 4);
    if (!/^codex(?:\/[^:]+)?:/.test(agent.model)) return { status: "not_codex", estimatedTokens: 0 };
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT run_state, sleep_context FROM agents WHERE id = ? AND archived_at IS NULL", params: [agent.id] })) as any[])[0];
    if (!row || row.run_state !== "idle") return { status: "busy", estimatedTokens: 0 };
    const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: row.sleep_context });
    const active = sleep ? ctx.fns.agent.getSleepGeneration({ sleepContext: sleep, kind: "active" }) : null;
    const root = await ctx.fns.session.getMessages({ id: agent.id });
    const activeMessages = active?.contextAgentId ? await ctx.fns.session.getMessages({ id: String(active.contextAgentId) }) : (active?.contextMessages ?? []);
    const effective = active ? [...activeMessages, ...root.slice(Math.max(0, Number(active.tailStart ?? active.sourceOffset ?? 0)))] : root;
    const estimatedTokens = estimate(effective);
    if (active && active.tailStart >= root.length - 1) return { status: "already_compact", estimatedTokens };
    const configured = await ctx.fns.settings.getNumber({ module: "agent", scopeType: "global", key: "autoCompactTokens", fallback: 700000 });
    const threshold = Math.max(10000, Number(opts.thresholdTokens ?? configured ?? 700000));
    if (estimatedTokens < threshold) return { status: "below_threshold", estimatedTokens };
    try { const result = await ctx.fns.agent.compactContext({ agent }); return { status: result.status === "compacted" ? "compacted" : "already_compact", estimatedTokens }; }
    catch (error: any) { const message = String(error?.message ?? error); await ctx.fns.session.appendEventWithHtml({ id: agent.id, type: "auto_compaction_failed", payload: { estimatedTokens, error: message } }).catch(() => undefined); return { status: "failed", estimatedTokens, error: message }; }
}
