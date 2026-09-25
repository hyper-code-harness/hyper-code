// Function-RAG reranking in one round trip.
//
// jev.rank sends one request per candidate because a published ranking study
// found that packing candidates into a SINGLE question and sorting the result
// fails ordering gates. That is not this. Here each candidate gets its OWN
// question inside one request: questions in a request are evaluated
// independently against the shared state, so the isolation that matters is
// preserved while the network cost collapses from N round trips to one.
//
// The shared state is the user's prompt. Each question carries one candidate's
// documentation. A speculative `needs_tool` rides along for free — extra
// questions cost tokens, not latency.

/** Reranks retrieved runtime-function candidates against a user prompt in a single fan-out request. */
/**
 * Score every retrieved runtime-function candidate for how well it serves a user's
 * prompt, and return them reordered with the weak ones dropped.
 *
 * Use as the reranking stage between `runtime.docs.search` and function injection,
 * where lexical and vector retrieval produce a plausible but badly ordered window.
 * It fixes the ordering failures the hybrid retriever is known to have, including
 * cross-language prompts whose correct candidate sits below the cosine floor.
 *
 * One request carries one question per candidate plus a speculative `needs_tool`
 * judgment, so latency is a single round trip regardless of window size. Callers
 * should fall back to the original retrieval order when this throws.
 *
 * @param opts.query The user's prompt, in their own words and language.
 * @param opts.candidates Retrieved candidates with the documentation text to judge.
 * @param opts.limit How many candidates survive.
 * @param opts.minScore Relevance probability a candidate must reach to survive.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The user's prompt driving retrieval. */
    query: string;
    /** Retrieved candidates; name identifies them, text is what the model reads. */
    candidates: Array<{ name: string; text: string }>;
    /** Maximum candidates returned after reranking. @default 5 @minimum 1 @maximum 50 */
    limit?: number;
    /** Minimum relevance probability required to survive. @default 0.3 @minimum 0 @maximum 1 */
    minScore?: number;
    /** Request timeout in milliseconds. @default 6000 @minimum 500 @maximum 30000 */
    timeoutMs?: number;
    /** Model id override passed through to jev.decide. */
    model?: string;
}): Promise<{
    functions: Array<{ name: string; score: number; rank: number; originalRank: number }>;
    needsTool: number;
    dropped: number;
    latencyMs: number;
}> {
    const items = (opts.candidates ?? []).filter((c) => c && typeof c.name === "string" && typeof c.text === "string");
    if (items.length === 0) return { functions: [], needsTool: 0, dropped: 0, latencyMs: 0 };

    const limit = Math.min(50, Math.max(1, opts.limit ?? 5));
    const minScore = Math.min(1, Math.max(0, opts.minScore ?? 0.3));

    // Question ids must survive the round trip, so they are positional rather
    // than derived from function names, which contain dots.
    const questions: Record<string, types.jev.Question> = {
        needs_tool: {
            type: "noul",
            instructions: "Does answering this prompt require calling a runtime function at all, rather than replying directly?",
        },
    };
    items.forEach((item, index) => {
        questions[`c${index}`] = {
            type: "noul",
            instructions: {
                task: "Does this runtime function perform the operation the user is asking for?",
                candidate: item.text.slice(0, 800),
            },
            criteria: {
                true: "This function performs the requested operation",
                false: "This function is unrelated, or only superficially similar",
            },
        };
    });

    const out = await ctx.fns.jev.decide({
        state: opts.query,
        questions,
        timeoutMs: opts.timeoutMs ?? 6000,
        ...(opts.model ? { model: opts.model } : {}),
    });

    const needsToolAnswer = out.answers.needs_tool;
    const needsTool = needsToolAnswer && needsToolAnswer.type === "noul" ? needsToolAnswer.noul : 1;

    const scored = items.map((item, index) => {
        const answer = out.answers[`c${index}`];
        return {
            name: item.name,
            score: answer && answer.type === "noul" ? answer.noul : 0,
            originalRank: index + 1,
        };
    });

    const kept = scored
        .filter((candidate) => candidate.score >= minScore)
        .sort((a, b) => (b.score - a.score) || (a.originalRank - b.originalRank))
        .slice(0, limit)
        .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    return { functions: kept, needsTool, dropped: scored.length - kept.length, latencyMs: out.latencyMs };
}
