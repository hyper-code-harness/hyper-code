/**
 * Compacts an oversized idle agent after a successful turn
 *
 * Estimate the effective context after a completed run and invoke the provider's `$compaction_<provider>` compactor (or `$compaction_default`) when it exceeds the threshold: the smaller of the global `autoCompactTokens` setting and `autoCompactWindowPercent` of the model's context window (Claude 200K, Codex 272K). The size is the larger of a chars/4 estimate and the last provider-reported prompt tokens. Skip agents without a compactor, running, already compacted, or too-small agents; failures are recorded as events but do not fail the completed user turn.
 * @param opts.agent Live agent to inspect after its run has finalized.
 * @param opts.thresholdTokens Token threshold overriding both settings. @minimum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live agent to inspect after its run has finalized. */
        agent: types.agent.Agent;
        /** Token threshold overriding both settings. @minimum 10000 */
        thresholdTokens?: number;
    },
): Promise<{ status: "compacted" | "below_threshold" | "no_compactor" | "already_compact" | "busy" | "failed"; estimatedTokens: number; error?: string }> {
    const agent = opts.agent;
    const estimate = (messages: any[]) => Math.ceil(messages.reduce((n: number, m: any) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length) + JSON.stringify(m.tool_calls ?? []).length, 0) / 4);
    try { ctx.fns.compaction.resolve({ model: agent.model }); } catch { return { status: "no_compactor", estimatedTokens: 0 }; }
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT run_state, sleep_context FROM agents WHERE id = ? AND archived_at IS NULL", params: [agent.id] })) as any[])[0];
    if (!row || row.run_state !== "idle") return { status: "busy", estimatedTokens: 0 };
    const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: row.sleep_context });
    const active = sleep ? ctx.fns.agent.getSleepGeneration({ sleepContext: sleep, kind: "active" }) : null;
    const root = await ctx.fns.session.getMessages({ id: agent.id });
    const storedActive = active?.contextAgentId ? await ctx.fns.session.getMessages({ id: String(active.contextAgentId) }) : (active?.contextMessages ?? []);
    // Same view as buildLlmRequest: a foreign checkpoint is adapted, an unreadable one means the full transcript.
    const activeMessages = active ? ctx.fns.compaction.portable({ model: agent.model, producedBy: active.model, messages: storedActive }) : [];
    const effective = active && activeMessages ? [...activeMessages, ...root.slice(Math.max(0, Number(active.tailStart ?? active.sourceOffset ?? 0)))] : root;
    // chars/4 underestimates code and JSON; the provider's own count of the last
    // request is authoritative when it exists (it predates this turn's reply).
    const last = ((await ctx.fns.procs.db.select({ sql: "SELECT payload, ts FROM events WHERE agent_id = ? AND type = 'assistant' ORDER BY idx DESC LIMIT 1", params: [agent.id] })) as any[])[0];
    let reported = 0;
    try { const usage = JSON.parse(String(last?.payload ?? "{}"))?.usage ?? {}; reported = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) + Number(usage.completion_tokens ?? usage.output_tokens ?? 0); } catch {}
    // A usage recorded before the active compaction describes the old, larger context.
    const fresh = !active || Number(last?.ts ?? 0) > Number(active.activatedAt ?? 0);
    const estimatedTokens = Math.max(estimate(effective), fresh ? reported : 0);
    if (active && activeMessages && active.tailStart >= root.length - 1) return { status: "already_compact", estimatedTokens };
    const configured = await ctx.fns.settings.getNumber({ module: "agent", scopeType: "global", key: "autoCompactTokens", fallback: 700000 });
    const percent = await ctx.fns.settings.getNumber({ module: "agent", scopeType: "global", key: "autoCompactWindowPercent", fallback: 80 });
    const window = ctx.fns.compaction.contextWindow({ model: agent.model });
    const byWindow = window ? Math.floor(window * Math.min(95, Math.max(30, Number(percent ?? 80))) / 100) : Infinity;
    const threshold = Math.max(10000, Number(opts.thresholdTokens ?? Math.min(Number(configured ?? 700000), byWindow)));
    if (estimatedTokens < threshold) return { status: "below_threshold", estimatedTokens };
    try { const result = await ctx.fns.agent.compactContext({ agent }); return { status: result.status === "compacted" ? "compacted" : "already_compact", estimatedTokens }; }
    catch (error: any) { const message = String(error?.message ?? error); await ctx.fns.session.appendEventWithHtml({ id: agent.id, type: "auto_compaction_failed", payload: { estimatedTokens, error: message } }).catch(() => undefined); return { status: "failed", estimatedTokens, error: message }; }
}
