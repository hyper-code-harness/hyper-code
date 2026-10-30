/**
 * Compacts an idle agent context into a hidden summary fork and retained verbatim tail
 *
 * Use for manual, non-destructive context compaction. It summarizes the current effective projection, preserves a safe recent tail, and atomically activates only when the root transcript and compact head remain unchanged.
 * @param opts.agent Live root agent whose effective model context is compacted.
 * @param opts.instructions Optional focus instructions appended to the handoff summarizer prompt.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live root agent whose effective model context is compacted. */
        agent: types.agent.Agent;
        /** Optional focus instructions appended to the handoff summarizer prompt. */
        instructions?: string;
    },
): Promise<{ status: "compacted" | "not_needed" | "stale"; revision?: number; tokensBefore: number; tokensAfter?: number; keptMessages?: number; summary?: string }> {
    const parent = opts.agent;
    const estimate = (messages: any[]) => Math.ceil(messages.reduce((n: number, m: any) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length) + JSON.stringify(m.tool_calls ?? []).length, 0) / 4);
    // Images are dropped from the compaction request: the summary is text, and screenshots in a long transcript
    // overflow the provider's request size limit ("too many total text bytes"). The tail keeps them as they were.
    const isImage = (p: any) => p && typeof p === "object" && (p.type === "image" || p.type === "image_url" || p.type === "input_image");
    const stripImages = (c: any) => Array.isArray(c) ? c.map((p: any) => isImage(p) ? { type: "text", text: "[image omitted]" } : p) : c;
    const compactMessage = (m: any) => ({ role: m.role, content: stripImages(m.content), ...(m.message_type ? { message_type: m.message_type } : {}), ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) });
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT updated_at, run_state, sleep_context FROM agents WHERE id = ? AND archived_at IS NULL", params: [parent.id] })) as any[])[0];
    if (!row) throw new Error("agent not found");
    if (row.run_state !== "idle") throw new Error("agent is running");
    const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: row.sleep_context });
    if (sleep?.draftRevision != null) throw new Error("compaction already running");
    const oldHead = sleep?.activeRevision ?? null;
    // One view of history for every compaction offset: a fork's inherited parent
    // prefix plus its own rows (agent.contextHistory). Counting only own rows here
    // while buildLlmRequest sliced the full history cut forks mid-parent.
    const projection = await ctx.fns.agent.contextProjection({ agentId: parent.id, model: parent.model, sleepContext: sleep });
    const history = projection.history;
    const sourceFrontier = projection.ownRows;
    // Summarizers that replay the transcript natively (Codex) refuse a tool result
    // without its call, so the summarised view gets the same repair as a request.
    const effective = ctx.fns.session.repairToolPairs({ messages: projection.messages }).messages;
    const tokensBefore = estimate(effective);
    let tailStart = history.length;
    let chars = 0;
    let textCount = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (!m) continue;
      const size = (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length) + JSON.stringify(m.tool_calls ?? []).length;
      if (chars + size > 120000 && textCount >= 5) break;
      chars += size; tailStart = i;
      if (typeof m.content === "string" && m.content.trim()) textCount++;
      if (chars >= 160000 && textCount >= 5) break;
    }
    // The tail must not open with a tool result whose call was summarised away:
    // pull the boundary back to the earliest assistant message that issued a call
    // answered inside the tail.
    const callAt = new Map<string, number>();
    history.forEach((m: any, i: number) => { for (const c of m?.tool_calls ?? []) if (c?.id != null && !callAt.has(String(c.id))) callAt.set(String(c.id), i); });
    for (let moved = true; moved && tailStart > 0;) {
      moved = false;
      for (let i = tailStart; i < history.length; i++) {
        const id = history[i]?.role === "tool" ? history[i]?.tool_call_id : null;
        const at = id != null ? callAt.get(String(id)) : undefined;
        if (at != null && at < tailStart) { tailStart = at; moved = true; break; }
      }
    }
    while (tailStart > 0 && history[tailStart]?.role === "tool") tailStart--;
    if (tailStart > 0 && history[tailStart - 1]?.role === "assistant" && history[tailStart - 1]?.tool_calls?.length) tailStart--;
    // A legacy fork generation summarised only the fork's own rows; any real
    // boundary improves on it, so it never blocks a new compaction.
    if (tailStart <= (projection.tailStart != null && !projection.legacy ? projection.tailStart : 0)) return { status: "not_needed", tokensBefore };
    const revision = Math.max(0, ...(sleep?.generations ?? []).map((g: any) => Number(g.revision ?? 0))) + 1;
    const createdAt = Date.now();
    const draftOwner = ((ctx.state as any).compactionOwner ??= crypto.randomUUID());
    const child = await ctx.fns.agent.start({ model: parent.model, systemPrompt: parent.systemPrompt, systemPromptName: parent.systemPromptName, systemPromptCore: parent.systemPromptCore, title: (parent.title || parent.id) + " · compact", workspaceDir: parent.workspaceDir, workspaceHost: parent.workspaceHost, parentId: parent.id, forkOffset: 0, visibility: "hidden" });
    child.scratchpad = { compaction: { sourceAgentId: parent.id, revision, status: "draft" } };
    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
    // basis "context": tailStart and sourceOffset count agent.contextHistory, whose
    // first `inherited` messages are the parent prefix; sourceFrontier is the
    // agent's own row count, the token that detects concurrent writes.
    const generation: any = { revision, kind: "compaction", status: "draft", basis: "context", inherited: projection.inherited, contextAgentId: child.id, sourceAgentId: parent.id, sourceOffset: history.length, sourceFrontier, tailStart, summary: "", ...(opts.instructions?.trim() ? { instructions: opts.instructions.trim() } : {}), tokensBefore, tokensAfter: 0, model: parent.model, createdAt };
    const draftContext = { mode: sleep?.mode ?? "full", activeRevision: oldHead, draftRevision: revision, draftOwner, generations: [...(sleep?.generations ?? []), generation].slice(-8) };
    const draftAt = Date.now();
    const drafted = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb, updated_at = ? WHERE id = ? AND updated_at = ? AND run_state = 'idle'", params: [JSON.stringify(draftContext), draftAt, parent.id, Number(row.updated_at)] });
    if (!drafted.changes) { await ctx.fns.session.archive({ id: child.id }).catch(() => undefined); return { status: "stale", tokensBefore }; }
    parent.sleepContext = draftContext;
    await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_start", payload: { revision } });
    try {
      // Provider-specific strategy from `$compaction_<provider>.ts`, else `$compaction_default.ts`.
      const compactor = ctx.fns.compaction.resolve({ model: child.model });
      const result = await compactor.compact(ctx, session, {
        model: child.model,
        sessionId: child.id,
        instructions: await ctx.fns.agent.fullSystemPrompt({ agent: parent }),
        focus: opts.instructions?.trim() || undefined,
        messages: effective.map(compactMessage),
      });
      const summary = result.summary;
      const summaryMessage: any = result.message;
      const tokensAfter = estimate([summaryMessage, ...history.slice(tailStart)]);
      generation.compactor = compactor.provider;
      await ctx.fns.session.appendMessage({ id: child.id, message: summaryMessage });
      // All own rows, excluded ones too: the same count the activation UPDATE checks.
      const currentCount = Number(((await ctx.fns.procs.db.select({ sql: "SELECT COUNT(*) AS n FROM messages WHERE agent_id = ?", params: [parent.id] })) as any[])[0]?.n ?? 0);
      const currentRow = ((await ctx.fns.procs.db.select({ sql: "SELECT updated_at, run_state, sleep_context FROM agents WHERE id = ?", params: [parent.id] })) as any[])[0];
      const currentSleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: currentRow?.sleep_context });
      const valid = currentRow?.run_state === "idle" && currentCount === sourceFrontier && currentSleep?.draftRevision === revision && currentSleep?.activeRevision === oldHead;
      if (!valid) {
        generation.status = "stale"; generation.summary = summary;
        const stale = { ...draftContext, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context->>'draftRevision' = ?", params: [JSON.stringify(stale), parent.id, String(revision)] });
        parent.sleepContext = stale;
        return { status: "stale", tokensBefore };
      }
      Object.assign(generation, { status: "active", summary, tokensAfter, activatedAt: Date.now() });
      const next = { mode: "compact", activeRevision: revision, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
      const activated = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb, updated_at = ? WHERE id = ? AND updated_at = ? AND run_state = 'idle' AND (SELECT COUNT(*) FROM messages WHERE agent_id = ?) = ?", params: [JSON.stringify(next), generation.activatedAt, parent.id, Number(currentRow.updated_at), parent.id, sourceFrontier] });
      if (!activated.changes) {
        generation.status = "stale";
        delete generation.activatedAt;
        const stale = { ...draftContext, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context->>'draftRevision' = ?", params: [JSON.stringify(stale), parent.id, String(revision)] });
        parent.sleepContext = stale;
        return { status: "stale", tokensBefore };
      }
      parent.sleepContext = next;
      await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_completed", payload: { revision, tokensBefore, tokensAfter, keptMessages: history.length - tailStart, summary } });
      return { status: "compacted", revision, tokensBefore, tokensAfter, keptMessages: history.length - tailStart, summary };
    } catch (error: any) {
      generation.status = "failed";
      const failed = { ...draftContext, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
      await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context->>'draftRevision' = ?", params: [JSON.stringify(failed), parent.id, String(revision)] }).catch(() => undefined);
      parent.sleepContext = failed;
      await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_failed", payload: { revision, error: String(error?.message ?? error) } }).catch(() => undefined);
      throw error;
    }
}
