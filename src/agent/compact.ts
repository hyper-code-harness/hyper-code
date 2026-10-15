// Two operations available to the agent for shrinking transcript context:
// 1. compact({ agent, summary: "summary string" })
//    Find the most recent §result:* / §error:* synthetic user-message
//    and replace its content with a "[compacted] <summary>" note. Loses the
//    verbose tool output but keeps the call→result chain intact for the LLM.
// 2. compact({ agent, message: <idx>, summary: "..." })
//    Drop messages[<idx>..] and replace with one synthetic user note. If
//    <idx> lands inside a marker pair, walks back over the pair so we never
//    leave half a pair stranded — same invariant as truncateMessagesFrom.
// A call and its answer are one unit: compaction may not cut between them,
// because a provider rejects a transcript with either half missing.
const isAssistantInvocation = (_ctx: Context, m: any): boolean =>
    m?.role === "assistant" && m?.tool_calls != null;
const isToolResult = (_ctx: Context, m: any): boolean =>
    m?.role === "tool" || m?.tool_call_id != null;

/** Compact for the runtime.  * @param opts.agent Agent whose state is read or updated.
 * @param opts.summary Concise summary of completed work or compacted context.
 * @param opts.message Optional message retained with the summary.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Live agent instance to operate on. */
    agent: types.agent.Agent;
        /** Concise summary of the operation or result. */
    summary: string;
        /** Message to persist or process. */
    message?: number },
): Promise<{ replaced: boolean; from?: number; before?: number; after?: number; resultIdx?: number }> {
    const { agent, summary: summaryRaw, message: from } = opts;
    await ctx.fns?.session?.syncAgentState?.({ agent });

    // Replacement writes own rows only. Never materialize or mutate inherited
    // history merely because the live transcript contains the parent's prefix.
    const ownCount = agent.parentId ? (await ctx.fns.session.getMessages({id:agent.id})).length : agent.messages.length;
    const inheritedCount = Math.max(0, agent.messages.length - ownCount);

    if (Number.isInteger(from)) {
        const idx = from as number;
        if (idx < 0 || idx >= agent.messages.length) {
            return { replaced: false };
        }
        let effectiveFrom = idx;
        while (effectiveFrom > 0) {
            const cur = agent.messages[effectiveFrom];
            const prev = agent.messages[effectiveFrom - 1];
            if (isToolResult(ctx, cur) || isAssistantInvocation(ctx, prev)) effectiveFrom -= 1;
            else break;
        }
        if (effectiveFrom < inheritedCount) return {replaced:false};
        const dropped = agent.messages.slice(effectiveFrom);
        const before = dropped.reduce((n, m) => n + JSON.stringify(m).length, 0);
        const note = `[compacted from #${effectiveFrom}, ${dropped.length} msg(s)] ${summaryRaw}`;
        const next = agent.messages.slice(0, effectiveFrom);
        next.push({ role: "user", content: note });
        await ctx.fns?.session?.replaceMessages?.({ id: agent.id, messages: next.slice(inheritedCount) });
        await ctx.fns?.session?.syncAgentState?.({ agent });
        return { replaced: true, from: effectiveFrom, before, after: note.length };
    }

    // String form: shrink the most recent tool-result message in place.
    const summary = String(summaryRaw);
    for (let i = agent.messages.length - 1; i >= inheritedCount; i--) {
        const m = agent.messages[i];
        if (!m || !isToolResult(ctx, m)) continue;
        const before = String(m.content ?? "").length;
        const newContent = `[compacted] ${summary}`;
        const next = agent.messages.slice();
        next[i] = { ...m, content: newContent };
        await ctx.fns?.session?.replaceMessages?.({ id: agent.id, messages: next.slice(inheritedCount) });
        await ctx.fns?.session?.syncAgentState?.({ agent });
        return { replaced: true, resultIdx: i, before, after: newContent.length };
    }
    return { replaced: false };
}
