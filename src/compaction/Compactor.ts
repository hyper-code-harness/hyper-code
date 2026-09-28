/**
 * One provider-specific way to shrink a model context, declared by a
 * `$compaction_<provider>.ts` file and selected by `compaction.resolve`.
 */
export type Compactor = (ctx: Context, session: Session | null, opts: {
    /** Provider-qualified model of the agent being compacted. */
    model: string;
    /** Stable id of the hidden compaction child, used as the provider session id. */
    sessionId: string;
    /** Full effective system prompt of the compacted agent. */
    instructions: string;
    /** Optional user focus instructions for this compaction. */
    focus?: string;
    /** Effective transcript to compact, oldest first, canonical message shape. */
    messages: any[];
    /** Optional cancellation signal. */
    signal?: AbortSignal;
}) => Promise<types.compaction.CompactionResult>;
