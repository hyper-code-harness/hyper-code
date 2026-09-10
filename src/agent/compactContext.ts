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
    const compactMessage = (m: any) => ({ role: m.role, content: m.content, ...(m.message_type ? { message_type: m.message_type } : {}), ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) });
    const rootMessages = await ctx.fns.session.getMessages({ id: parent.id });
    const sourceFrontier = rootMessages.length;
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT updated_at, run_state, sleep_context FROM agents WHERE id = ? AND archived_at IS NULL", params: [parent.id] })) as any[])[0];
    if (!row) throw new Error("agent not found");
    if (row.run_state !== "idle") throw new Error("agent is running");
    const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: row.sleep_context });
    if (sleep?.draftRevision != null) throw new Error("compaction already running");
    const active = sleep ? ctx.fns.agent.getSleepGeneration({ sleepContext: sleep, kind: "active" }) : null;
    const oldHead = sleep?.activeRevision ?? null;
    const activeMessages = active?.contextAgentId ? await ctx.fns.session.getMessages({ id: String(active.contextAgentId) }) : (active?.contextMessages ?? []);
    const effective = active ? [...activeMessages, ...rootMessages.slice(Math.max(0, Number(active.tailStart ?? active.sourceOffset ?? 0)))] : rootMessages;
    const tokensBefore = estimate(effective);
    let tailStart = rootMessages.length;
    let chars = 0;
    let textCount = 0;
    for (let i = rootMessages.length - 1; i >= 0; i--) {
      const m = rootMessages[i];
      const size = (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length) + JSON.stringify(m.tool_calls ?? []).length;
      if (chars + size > 120000 && textCount >= 5) break;
      chars += size; tailStart = i;
      if (typeof m.content === "string" && m.content.trim()) textCount++;
      if (chars >= 160000 && textCount >= 5) break;
    }
    while (tailStart > 0 && rootMessages[tailStart]?.role === "tool") tailStart--;
    if (tailStart > 0 && rootMessages[tailStart - 1]?.role === "assistant" && rootMessages[tailStart - 1]?.tool_calls?.length) tailStart--;
    if (tailStart <= Math.max(0, Number(active?.tailStart ?? 0))) return { status: "not_needed", tokensBefore };
    const revision = Math.max(0, ...(sleep?.generations ?? []).map((g: any) => Number(g.revision ?? 0))) + 1;
    const createdAt = Date.now();
    const child = await ctx.fns.agent.start({ model: parent.model, systemPrompt: parent.systemPrompt, title: (parent.title || parent.id) + " · compact", workspaceDir: parent.workspaceDir, parentId: parent.id, forkOffset: 0 });
    child.scratchpad = { compaction: { sourceAgentId: parent.id, revision, status: "draft" } };
    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
    const generation: any = { revision, kind: "compaction", status: "draft", contextAgentId: child.id, sourceAgentId: parent.id, sourceOffset: sourceFrontier, sourceFrontier, tailStart, summary: "", ...(opts.instructions?.trim() ? { instructions: opts.instructions.trim() } : {}), tokensBefore, tokensAfter: 0, model: parent.model, createdAt };
    const draftContext = { mode: sleep?.mode ?? "full", activeRevision: oldHead, draftRevision: revision, generations: [...(sleep?.generations ?? []), generation].slice(-8) };
    const draftAt = Date.now();
    const drafted = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb, updated_at = ? WHERE id = ? AND updated_at = ? AND run_state = 'idle'", params: [JSON.stringify(draftContext), draftAt, parent.id, Number(row.updated_at)] });
    if (!drafted.changes) { await ctx.fns.session.archive({ id: child.id }).catch(() => undefined); return { status: "stale", tokensBefore }; }
    parent.sleepContext = draftContext;
    await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_start", payload: { revision } });
    try {
      const prompt = "Create a concise continuation checkpoint for another coding agent. Include current goal, progress, decisions and rationale, constraints, rejected approaches, files changed/read, errors, unresolved issues, exact identifiers/paths/references, and clear next steps. Recent messages after this summary will be preserved verbatim. Do not repeat runtime/system instructions. Do not continue the task." + (opts.instructions?.trim() ? "\n\nFocus instructions: " + opts.instructions.trim() : "");
      let summary: string;
      let summaryMessage: any;
      let tokensAfter: number;
      if (/^codex(?:\/[^:]+)?:/.test(child.model)) {
        const checkpoint = await ctx.fns.llm.compactCodex({
          model: child.model,
          sessionId: child.id,
          instructions: await ctx.fns.agent.fullSystemPrompt({ agent: parent }),
          messages: effective.map(compactMessage),
        });
        summary = `Native Codex server checkpoint · ${checkpoint.responseId}`;
        summaryMessage = { role: "user", content: JSON.stringify(checkpoint.item), message_type: "codex_compaction" };
        tokensAfter = estimate([summaryMessage, ...rootMessages.slice(tailStart)]);
      } else {
        const call = await ctx.fns.llm.call({ model: child.model, sessionId: child.id, system: prompt, user: JSON.stringify(effective.map(compactMessage)) });
        summary = String(call.text ?? "").trim();
        if (!summary) throw new Error("compaction summary was empty");
        summaryMessage = { role: "user", content: summary, message_type: "compaction_summary" };
        tokensAfter = estimate([summaryMessage, ...rootMessages.slice(tailStart)]);
      }
      await ctx.fns.session.appendMessage({ id: child.id, message: summaryMessage });
      const currentCount = (await ctx.fns.session.getMessages({ id: parent.id })).length;
      const currentRow = ((await ctx.fns.procs.db.select({ sql: "SELECT updated_at, run_state, sleep_context FROM agents WHERE id = ?", params: [parent.id] })) as any[])[0];
      const currentSleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: currentRow?.sleep_context });
      const valid = currentRow?.run_state === "idle" && currentCount === sourceFrontier && currentSleep?.draftRevision === revision && currentSleep?.activeRevision === oldHead;
      if (!valid) {
        generation.status = "stale"; generation.summary = summary;
        const stale = { ...draftContext, draftRevision: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context->>'draftRevision' = ?", params: [JSON.stringify(stale), parent.id, String(revision)] });
        parent.sleepContext = stale;
        return { status: "stale", tokensBefore };
      }
      Object.assign(generation, { status: "active", summary, tokensAfter, activatedAt: Date.now() });
      const next = { mode: "compact", activeRevision: revision, draftRevision: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
      const activated = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb, updated_at = ? WHERE id = ? AND updated_at = ? AND run_state = 'idle' AND (SELECT COUNT(*) FROM messages WHERE agent_id = ?) = ?", params: [JSON.stringify(next), generation.activatedAt, parent.id, Number(currentRow.updated_at), parent.id, sourceFrontier] });
      if (!activated.changes) {
        generation.status = "stale";
        delete generation.activatedAt;
        const stale = { ...draftContext, draftRevision: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context->>'draftRevision' = ?", params: [JSON.stringify(stale), parent.id, String(revision)] });
        parent.sleepContext = stale;
        return { status: "stale", tokensBefore };
      }
      parent.sleepContext = next;
      await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_completed", payload: { revision, tokensBefore, tokensAfter, keptMessages: rootMessages.length - tailStart, summary } });
      return { status: "compacted", revision, tokensBefore, tokensAfter, keptMessages: rootMessages.length - tailStart, summary };
    } catch (error: any) {
      generation.status = "failed";
      const failed = { ...draftContext, draftRevision: null, generations: draftContext.generations.map((g: any) => g.revision === revision ? generation : g) };
      await ctx.fns.procs.db.run({ sql: "UPDATE agents SET sleep_context = ?::jsonb WHERE id = ? AND sleep_context->>'draftRevision' = ?", params: [JSON.stringify(failed), parent.id, String(revision)] }).catch(() => undefined);
      parent.sleepContext = failed;
      await ctx.fns.session.appendEventWithHtml({ id: parent.id, type: "compaction_failed", payload: { revision, error: String(error?.message ?? error) } }).catch(() => undefined);
      throw error;
    }
}
