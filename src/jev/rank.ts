// Reranking, deliberately one request per candidate.
//
// A published ranking study found that batching candidates into a single scoring
// question fails ordering gates that one-row-per-request passes, so the batch is
// issued as concurrent independent calls and the sort happens here, in code.

/** Reranks candidates by asking Jev one relevance question per item and sorting the probabilities. */
/**
 * Score every candidate independently against a query and return them ordered by
 * relevance, with the raw probability kept for inspection.
 *
 * Use as a reranking stage after lexical or vector retrieval, where the first-stage
 * ranking is cheap but imprecise: function and tool discovery, RAG passage selection,
 * search result ordering. Candidates are evaluated in separate concurrent requests
 * because batching them into one question degrades ordering.
 *
 * Failed individual requests keep their original position instead of dropping the
 * candidate, so a partial outage degrades the ranking rather than losing results.
 *
 * @param opts.query What the user is looking for, in their own words.
 * @param opts.candidates Items to score, each with a stable id and its text.
 * @param opts.instructions Relevance question override.
 * @param opts.concurrency How many requests are in flight at once.
 * @param opts.minScore Drop candidates whose probability falls below this value.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The user's query or intent the candidates are judged against. */
    query: string;
    /** Candidates to rerank; text is what the model reads. */
    candidates: Array<{ id: string; text: string }>;
    /** Relevance question; defaults to asking whether the candidate answers the query. */
    instructions?: string;
    /** Concurrent in-flight requests. @default 8 @minimum 1 @maximum 32 */
    concurrency?: number;
    /** Minimum probability a candidate must reach to be kept. @default 0 @minimum 0 @maximum 1 */
    minScore?: number;
    /** Request timeout per candidate in milliseconds. @default 5000 @minimum 500 @maximum 30000 */
    timeoutMs?: number;
    /** Model id override passed through to jev.decide. */
    model?: string;
}): Promise<{
    ranked: Array<{ id: string; score: number; rank: number; failed: boolean }>;
    scored: number;
    failed: number;
    latencyMs: number;
}> {
    const items = (opts.candidates ?? []).filter((c) => c && typeof c.id === "string" && typeof c.text === "string");
    if (items.length === 0) return { ranked: [], scored: 0, failed: 0, latencyMs: 0 };

    const instructions = opts.instructions
        ?? "Does this candidate satisfy what the user is asking for?";
    const concurrency = Math.min(32, Math.max(1, opts.concurrency ?? 8));
    const minScore = Math.min(1, Math.max(0, opts.minScore ?? 0));
    const startedAt = Date.now();

    const results = new Array<{ id: string; score: number; order: number; failed: boolean }>(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            const index = next++;
            const item = items[index];
            if (!item) return;
            try {
                const out = await ctx.fns.jev.decide({
                    state: { query: opts.query, candidate: item.text },
                    questions: { relevant: { type: "noul", instructions } },
                    timeoutMs: opts.timeoutMs ?? 5000,
                    ...(opts.model ? { model: opts.model } : {}),
                });
                const answer = out.answers.relevant;
                const score = answer && answer.type === "noul" ? answer.noul : 0;
                results[index] = { id: item.id, score, order: index, failed: false };
            } catch {
                // Keep the first-stage position rather than dropping the candidate.
                results[index] = { id: item.id, score: -1, order: index, failed: true };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));

    const failed = results.filter((r) => r.failed).length;
    const ranked = results
        .filter((r) => r.failed || r.score >= minScore)
        .sort((a, b) => (b.score - a.score) || (a.order - b.order))
        .map((r, i) => ({ id: r.id, score: r.failed ? 0 : r.score, rank: i + 1, failed: r.failed }));

    return { ranked, scored: results.length - failed, failed, latencyMs: Date.now() - startedAt };
}
