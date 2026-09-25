// Candidate selection with a mandatory escape hatch.
//
// Two measured facts shape this function. Option order changes the answer
// (published permutation study: 88% accuracy when the correct option is listed
// first, 57% when fourth), so the order actually used is returned for replay.
// And a model with no way to say "none of these" will always pick something,
// so an abstain option is offered by default.

/** Selects one candidate from a list with calibrated probabilities and an explicit abstain option. */
/**
 * Ask Jev to choose one candidate out of a closed list, returning the winner, the
 * full probability distribution and a confidence value.
 *
 * Use for tool and function selection, routing to a handler, entity resolution against
 * known records, or any decision whose answer is already one of N things your code
 * holds. The list is capped at 255 options; for larger spaces narrow the candidates
 * first or walk a taxonomy one level per call.
 *
 * Returns id null when the model abstains or when confidence falls below minConfidence,
 * so callers can fall back instead of acting on a coin flip.
 *
 * @param opts.candidates Options offered to the model, each with a stable id.
 * @param opts.instructions The decision being made, phrased as a question.
 * @param opts.state Context the decision is made against; defaults to the instructions alone.
 * @param opts.abstain Offer an explicit none-of-these option.
 * @param opts.order How the option list is ordered before sending.
 * @param opts.minConfidence Confidence below which the pick is reported as no decision.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Candidates to choose between; ids must be unique and are returned verbatim. */
    candidates: Array<{ id: string; description?: string }>;
    /** The question the model answers about the candidates. */
    instructions: string | Record<string, unknown>;
    /** State the candidates are judged against; omit to judge the instructions alone. */
    state?: string | Record<string, unknown> | unknown[];
    /** Offer an explicit none-of-these option. @default true */
    abstain?: boolean;
    /** Option ordering: as given, or shuffled to neutralise position bias. @default given */
    order?: "given" | "shuffle";
    /** Confidence floor below which no candidate is returned. @default 0 @minimum 0 @maximum 1 */
    minConfidence?: number;
    /** Model id override passed through to jev.decide. */
    model?: string;
}): Promise<{
    id: string | null;
    confidence: number;
    abstained: boolean;
    probabilities: Record<string, number>;
    orderUsed: string[];
    latencyMs: number;
}> {
    const ABSTAIN = "__none__";
    const list = (opts.candidates ?? []).filter((c) => c && typeof c.id === "string" && c.id && c.id !== ABSTAIN);
    if (list.length < 1) throw new Error("jev.pick: at least one candidate is required");

    const abstain = opts.abstain !== false;
    const limit = abstain ? 254 : 255;
    if (list.length > limit) throw new Error(`jev.pick: ${list.length} candidates exceeds the ${limit} option limit`);

    const ordered = opts.order === "shuffle" ? shuffle(list) : list.slice();
    const criteria: Record<string, any> = {};
    for (const c of ordered) criteria[c.id] = c.description ?? null;
    if (abstain) criteria[ABSTAIN] = "None of the listed options fits";

    const out = await ctx.fns.jev.decide({
        state: opts.state ?? opts.instructions,
        questions: { pick: { type: "choice", instructions: opts.instructions, criteria } },
        ...(opts.model ? { model: opts.model } : {}),
    });

    const answer = out.answers.pick as types.jev.ChoiceAnswer | undefined;
    if (!answer || answer.type !== "choice") throw new Error("jev.pick: provider returned no choice answer");

    const floor = Math.min(1, Math.max(0, opts.minConfidence ?? 0));
    const abstained = answer.choice === ABSTAIN;
    const belowFloor = answer.confidence < floor;
    return {
        id: abstained || belowFloor ? null : answer.choice,
        confidence: answer.confidence,
        abstained,
        probabilities: answer.probabilities,
        orderUsed: Object.keys(criteria),
        latencyMs: out.latencyMs,
    };
}

function shuffle<T>(items: T[]): T[] {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
}
