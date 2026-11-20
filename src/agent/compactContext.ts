/**
 * Compacts an idle agent context into a hidden summary fork and retained verbatim tail
 *
 * Use for immediate, non-destructive context compaction while idle; interactive controls use requestCompaction to queue it. It summarizes the current effective projection, preserves a safe recent tail, and atomically activates only when the root transcript and compact head remain unchanged.
 * @param opts.agent Live root agent whose effective model context is compacted.
 * @param opts.instructions Optional focus instructions appended to the handoff summarizer prompt.
 * @param opts.job Internal maintenance job id and lease token; activation and job completion commit together.
 * @param opts.signal Cancellation signal for a leased maintenance attempt.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live root agent whose effective model context is compacted. */
        agent: types.agent.Agent;
        /** Optional focus instructions appended to the handoff summarizer prompt. */
        instructions?: string;
        /** Worker-owned maintenance job identity; omit for immediate idle compaction. */
        job?: { id: string; token: string };
        /** Cooperative cancellation of the summarizer request. */
        signal?: AbortSignal;
    },
): Promise<{ status: "compacted" | "not_needed" | "stale"; revision?: number; tokensBefore: number; tokensAfter?: number; keptMessages?: number; summary?: string }> {
    const parent = opts.agent;
    // Enqueue, normal claims and compaction writes use the same row lock. The
    // following job read is a fresh statement, not a stale NOT EXISTS snapshot.
    const lockedWrite = async (fn: () => Promise<{ changes: number }>, existingDraft = false): Promise<{ changes: number }> =>
      await ctx.fns.procs.db.transaction({ fn: async () => {
        await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id=? FOR UPDATE", params: [parent.id] });
        if (opts.job) {
          const job = (await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE id=? AND agent_id=? AND runner='compaction' AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL FOR UPDATE", params: [opts.job.id,parent.id,opts.job.token,Date.now()] }))[0];
          if (!job) return { changes: 0 };
        } else if (!existingDraft) {
          const pending = await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE agent_id=? AND runner='compaction' AND status='running'", params: [parent.id] });
          if (pending.length) return { changes: 0 };
        }
        return await fn();
      } }) as { changes: number };
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
    const sourceFingerprint = JSON.stringify(history);
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
    const generation: any = { revision, kind: "compaction", status: "draft", basis: "context", inherited: projection.inherited, contextAgentId: child.id, sourceAgentId: parent.id, sourceOffset: history.length, sourceFrontier, tailStart, summary: "", ...(opts.instructions?.trim() ? { instructions: opts.instructions.trim() } : {}), ...(opts.job ? { jobId: opts.job.id, jobToken: opts.job.token } : {}), tokensBefore, tokensAfter: 0, model: parent.model, createdAt };
    const generations = [...(sleep?.generations ?? []), generation].slice(-8);
    // Failed/stale attempts must never evict the active checkpoint. Reserve one
    // of the eight slots for it when it falls outside the recent generations.
    const activeGeneration = sleep?.generations.find((g: any) => Number(g.revision) === oldHead);
    if (activeGeneration && !generations.includes(activeGeneration)) generations[0] = activeGeneration;
    const draftContext = { mode: sleep?.mode ?? "full", activeRevision: oldHead, draftRevision: revision, draftOwner, generations };
    // Keep an immutable CAS snapshot: generation is mutated with summary/status below.
    const draftJson = JSON.stringify(draftContext);
    const draftAt = Date.now();
    const drafted = await lockedWrite(async () => await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb, updated_at = ? WHERE id = ? AND updated_at = ? AND run_state = 'idle' AND run_token IS NULL AND archived_at IS NULL AND sleep_context->>'draftRevision' IS NULL", params: [draftJson, draftAt, parent.id, Number(row.updated_at)] }));
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
        signal: opts.signal,
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
      const currentHistory = await ctx.fns.agent.contextHistory({ id: parent.id });
      const valid = JSON.stringify(currentHistory.messages) === sourceFingerprint && currentRow?.run_state === "idle" && currentCount === sourceFrontier && currentSleep?.draftRevision === revision && currentSleep?.activeRevision === oldHead;
      if (!valid) {
        generation.status = "stale"; generation.summary = summary;
        const stale = { ...draftContext, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
        const cleared = await lockedWrite(async () => await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context = ?::jsonb", params: [JSON.stringify(stale), parent.id, draftJson] }), true);
        if (cleared.changes) parent.sleepContext = stale;
        return { status: "stale", tokensBefore };
      }
      Object.assign(generation, { status: "active", summary, tokensAfter, activatedAt: Date.now() });
      const next = { mode: "compact", activeRevision: revision, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
      const activated = await lockedWrite(async () => {
        // Detect same-row-count edits and edits to the inherited fork prefix too.
        const latest = await ctx.fns.agent.contextHistory({ id: parent.id });
        if (JSON.stringify(latest.messages) !== sourceFingerprint) return { changes: 0 };
        const changed = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb, updated_at = ? WHERE id = ? AND updated_at = ? AND run_state = 'idle' AND run_token IS NULL AND archived_at IS NULL AND sleep_context = ?::jsonb AND (SELECT COUNT(*) FROM messages WHERE agent_id = ?) = ?", params: [JSON.stringify(next), generation.activatedAt, parent.id, Number(currentRow.updated_at), draftJson, parent.id, sourceFrontier] });
        if (changed.changes && opts.job) await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET status='succeeded',outcome_reason='compacted',result=?::jsonb,finished_at=?,updated_at=?,next_at=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?", params: [JSON.stringify({ revision,tokensBefore,tokensAfter }),Date.now(),Date.now(),opts.job.id,opts.job.token] });
        return changed;
      }, true);
      if (!activated.changes) {
        generation.status = "stale";
        delete generation.activatedAt;
        const stale = { ...draftContext, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
        const cleared = await lockedWrite(async () => await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context = ?::jsonb", params: [JSON.stringify(stale), parent.id, draftJson] }), true);
        if (cleared.changes) parent.sleepContext = stale;
        return { status: "stale", tokensBefore };
      }
      parent.sleepContext = next;
      // The checkpoint and job are already committed. A notification failure
      // must not turn that successful generation into a failed in-memory one.
      await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_completed", payload: { revision, tokensBefore, tokensAfter, keptMessages: history.length - tailStart, summary } }).catch((error: Error) => console.error("compaction completion notification failed:", error));
      return { status: "compacted", revision, tokensBefore, tokensAfter, keptMessages: history.length - tailStart, summary };
    } catch (error: any) {
      generation.status = "failed";
      const failed = { ...draftContext, draftRevision: null, draftOwner: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
      const cleared = await lockedWrite(async () => await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context = ?::jsonb", params: [JSON.stringify(failed), parent.id, draftJson] }), true).catch(() => ({ changes: 0 }));
      if (cleared.changes) parent.sleepContext = failed;
      await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_failed", payload: { revision, error: String(error?.message ?? error) } }).catch(() => undefined);
      throw error;
    }
}
