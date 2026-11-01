/**
 * Assemble what an agent's model sees: its context history, or the active compaction checkpoint plus the verbatim tail.
 *
 * The single place that applies a compaction generation to history. Loads agent.contextHistory (a fork's inherited parent prefix plus its own rows), maps the active generation's tail through agent.compactTail, adapts the checkpoint with compaction.portable, and returns the effective messages with the coordinates used. A legacy fork generation (made when compaction counted only own rows) summarised only the fork's own messages, so it is projected as inherited prefix + checkpoint + own tail — nothing is lost and the next compaction replaces it. An unusable generation (unreadable checkpoint, truncated history, edited prefix) yields the full history. Use it in buildLlmRequest, compactContext, autoCompactIfNeeded and renderSleepContextHtml instead of slicing history by hand.
 * @param opts.agentId Agent whose model context is projected.
 * @param opts.model Provider-qualified model that will read the projection; decides whether a checkpoint is readable.
 * @param opts.sleepContext Persisted sleep context; when omitted the projection is the plain context history.
 * @param opts.rootMessages Live transcript of a ROOT agent to use instead of reading it from the database; ignored for forks.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose model context is projected. */
        agentId: string;
        /** Provider-qualified model that will read the projection; decides whether a checkpoint is readable. */
        model: string;
        /** Persisted sleep context; when omitted the projection is the plain context history. */
        sleepContext?: any;
        /** Live transcript of a ROOT agent to use instead of reading it from the database; ignored for forks. */
        rootMessages?: any[];
    },
): Promise<{ messages: any[]; history: any[]; inherited: number; ownRows: number; generation: Record<string, any> | null; checkpoint: any[] | null; tailStart: number | null; legacy: boolean }> {
    const parent = ((await ctx.fns.procs.db.select({ sql: "SELECT parent_id FROM agents WHERE id = ?", params: [opts.agentId] })) as any[])[0]?.parent_id;
        const h = !parent && Array.isArray(opts.rootMessages)
            ? { messages: opts.rootMessages, inherited: 0, ownRows: -1 }
            : await ctx.fns.agent.contextHistory({ id: opts.agentId });
        const plain = { messages: h.messages, history: h.messages, inherited: h.inherited, ownRows: h.ownRows, generation: null, checkpoint: null, tailStart: null, legacy: false };
        const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: opts.sleepContext });
        const generation = sleep?.mode === "compact" ? ctx.fns.agent.getSleepGeneration({ sleepContext: sleep, kind: "active" }) : null;
        if (!generation) return plain;
        const stored = generation.contextAgentId
            ? await ctx.fns.session.getMessages({ id: String(generation.contextAgentId) })
            : (generation.contextMessages ?? []);
        // A checkpoint made by another model is adapted (Claude block → text) or,
        // when unreadable (Codex item), dropped in favour of the full history.
        const checkpoint = stored?.length ? ctx.fns.compaction.portable({ model: opts.model, producedBy: generation.model, messages: stored }) : null;
        const { start, legacy } = ctx.fns.agent.compactTail({ generation, agentId: opts.agentId, inherited: h.inherited, length: h.messages.length });
        if (!checkpoint?.length || start == null) return { ...plain, generation, checkpoint: checkpoint ?? null, legacy };
        const messages = legacy
            ? [...h.messages.slice(0, h.inherited), ...checkpoint, ...h.messages.slice(start)]
            : [...checkpoint, ...h.messages.slice(start)];
        return { messages, history: h.messages, inherited: h.inherited, ownRows: h.ownRows, generation, checkpoint, tailStart: start, legacy };
}
