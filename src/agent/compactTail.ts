/**
 * Resolve where a compaction generation's verbatim tail starts in an agent's current context history.
 *
 * Maps a generation's tailStart onto the agent's context history (agent.contextHistory coordinates) and tells whether the generation is usable. Generations made by compactContext with basis 'context' store tailStart in context coordinates plus the inherited prefix length; if the prefix length changed since, a tail inside the agent's own rows is shifted, a tail inside the prefix is stale. Legacy generations (no basis) made by this agent counted only its own rows, so for a fork they are shifted by the inherited prefix and flagged legacy, which autoCompactIfNeeded then replaces with a full-history compaction. A generation copied from another agent (goal sidecar) is already in the source's coordinates, which are this agent's prefix coordinates. Use before slicing history with a generation in buildLlmRequest, compactContext, autoCompactIfNeeded and renderSleepContextHtml.
 * @param opts.generation Active compaction generation from agent.getSleepGeneration.
 * @param opts.agentId Agent whose context history the tail is applied to.
 * @param opts.inherited Current inherited prefix length from agent.contextHistory. @minimum 0
 * @param opts.length Current context history length from agent.contextHistory. @minimum 0
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Active compaction generation from agent.getSleepGeneration. */
        generation: Record<string, any>;
        /** Agent whose context history the tail is applied to. */
        agentId: string;
        /** Current inherited prefix length from agent.contextHistory. @minimum 0 */
        inherited: number;
        /** Current context history length from agent.contextHistory. @minimum 0 */
        length: number;
    },
): { start: number | null; legacy: boolean } {
    const g = opts.generation ?? {};
    const raw = Math.max(0, Number(g.tailStart ?? g.sourceOffset ?? 0));
    if (!Number.isFinite(raw)) return { start: null, legacy: false };
    const inherited = Math.max(0, Number(opts.inherited ?? 0));
    // A generation copied from another agent (goal sidecar) counts the source's
    // context history, which is this agent's inherited prefix.
    const own = !g.sourceAgentId || String(g.sourceAgentId) === opts.agentId;
    let start: number | null;
    let legacy = false;
    if (!own) start = raw;
    else if (g.basis === "context") {
        // The inherited prefix can change length if the parent is edited. A tail
        // inside the agent's own rows moves with it; one inside the prefix no
        // longer points at the message it was cut at.
        const was = Math.max(0, Number(g.inherited ?? 0));
        start = raw >= was ? raw + (inherited - was) : (was === inherited ? raw : null);
    } else {
        // Before basis existed, compaction counted only the agent's own rows.
        start = inherited + raw;
        legacy = inherited > 0;
    }
    // Rows the generation summarised are gone (history truncated): its checkpoint
    // describes messages that no longer exist, so the full history is used.
    const ownNow = opts.length - inherited;
    const ownThen = own ? Number(g.sourceOffset ?? 0) - (g.basis === "context" ? Math.max(0, Number(g.inherited ?? 0)) : 0) : 0;
    if (own && ownThen > ownNow) return { start: null, legacy };
    if (start == null || start > opts.length) return { start: null, legacy };
    return { start, legacy };
}
