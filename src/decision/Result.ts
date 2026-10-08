/** Outcome of one decision round trip: answers keyed by question id plus what it cost. */
export type Result = {
    /** Answer per question id, in the ids the caller supplied. */
    answers: Record<string, types.decision.Answer>;
    /** Engine that produced the answers. */
    engine: types.decision.Engine;
    /** Model id the engine reported. */
    model: string;
    /** Billed usage; output tokens are zero on both engines. */
    usage: { inputTokens: number; outputTokens: number; cost: number | null };
    /** Wall-clock duration of the successful attempt. */
    latencyMs: number;
};
