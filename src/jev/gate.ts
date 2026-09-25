// One decision plus the vendor's three-band confidence policy, so thresholds
// live in one place instead of being retyped at every call site.
//
// Calibration describes populations of answers, not the answer in hand: a high
// band means "act without asking", never "this is certainly correct". Keep
// deterministic checks in front of anything destructive.

/** Evaluates one yes/no or multiple-choice decision and maps its certainty onto act, confirm or escalate. */
/**
 * Ask Jev a single question and translate the result into a three-band verdict that
 * code can branch on: act automatically, ask for confirmation, or escalate to a human.
 *
 * Use as a fast guard in front of an action: does this message need a tool, is this
 * content a policy violation, is this transcript ready to compact, should this
 * destructive command proceed. Raise the thresholds with the stakes — a read-only path
 * can act at 0.6 while a push or delete should not act below 0.9.
 *
 * Noul questions have no confidence of their own, so the distance of the probability
 * from 0.5 is used as the certainty signal and `value` is the boolean verdict.
 *
 * @param opts.question The typed question to evaluate.
 * @param opts.state State the question is evaluated against.
 * @param opts.high Certainty at or above which the band is act.
 * @param opts.low Certainty below which the band is escalate.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Single typed question; choice, score or noul. */
    question: types.jev.Question;
    /** State the question is evaluated against. */
    state: string | Record<string, unknown> | unknown[];
    /** Certainty at or above which the caller may act unattended. @default 0.85 @minimum 0 @maximum 1 */
    high?: number;
    /** Certainty below which the caller must escalate. @default 0.5 @minimum 0 @maximum 1 */
    low?: number;
    /** Model id override passed through to jev.decide. */
    model?: string;
}): Promise<{
    band: types.jev.Band;
    value: string | number | boolean;
    confidence: number;
    answer: types.jev.Answer;
    latencyMs: number;
}> {
    const high = Math.min(1, Math.max(0, opts.high ?? 0.85));
    const low = Math.min(high, Math.max(0, opts.low ?? 0.5));

    const out = await ctx.fns.jev.decide({
        state: opts.state,
        questions: { gate: opts.question },
        ...(opts.model ? { model: opts.model } : {}),
    });
    const answer = out.answers.gate;
    if (!answer) throw new Error("jev.gate: provider returned no answer");

    let value: string | number | boolean;
    let confidence: number;
    if (answer.type === "noul") {
        value = answer.noul >= 0.5;
        // A noul carries no confidence field; distance from the coin flip is the signal.
        confidence = Math.abs(answer.noul - 0.5) * 2;
    } else if (answer.type === "choice") {
        value = answer.choice;
        confidence = answer.confidence;
    } else {
        value = answer.score;
        confidence = answer.confidence;
    }

    const band: types.jev.Band = confidence >= high ? "act" : confidence >= low ? "confirm" : "escalate";
    return { band, value, confidence, answer, latencyMs: out.latencyMs };
}
