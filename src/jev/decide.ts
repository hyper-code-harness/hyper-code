// Thin compatibility wrapper over the engine-neutral decision layer.
//
// Jev is not a chat model: it never reaches llm.call, has no messages, and
// returns typed values instead of text. The wire contract (POST /systemone with
// { model, state, questions }) now lives in decision.engineJev; this function
// stays so the existing jev.* call sites keep working unchanged.
//
// New code should call decision.ask, which can also route to OpenAI Decisions
// and accepts image evidence.

/** Calls the Jev System One endpoint with one shared state and a map of typed questions. */
/**
 * Ask a Jev decision model one or more typed questions about a shared state and
 * receive constrained answers with calibrated probabilities instead of text.
 *
 * Use when code needs a fast, structured judgment it can branch on: classification,
 * routing, scoring, detection, reranking or verification. All questions are evaluated
 * in parallel against the same state in one round trip, so send every question the
 * caller might need — extra questions cost tokens, not latency. Prefer several small
 * questions combined in code over one compound question.
 *
 * Pins the Jev backend. Prefer decision.ask when the engine should follow configuration
 * or the evidence includes images, which Jev cannot read.
 *
 * Not for generating text, arithmetic, date math or counting; keep those in code.
 * Throws on transport or provider failure so each caller can choose its own fallback.
 *
 * @param opts.state Application state the questions are evaluated against.
 * @param opts.questions Question id to typed question; answers return under the same ids.
 * @param opts.model Model id override; defaults to the jev.model setting.
 * @param opts.endpoint System One URL override; defaults to the jev.endpoint setting.
 * @param opts.apiKey Bearer token override; defaults to the OpenRouter or TypeSafe key.
 * @param opts.timeoutMs Abort the request after this many milliseconds.
 * @param opts.retries Retries on 429 and 5xx, honouring retry-after.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Application state evaluated by every question: text, a record, or a list. */
    state: string | Record<string, unknown> | unknown[];
    /** Map of caller-chosen question id to typed question. */
    questions: Record<string, types.jev.Question>;
    /** Model id override, such as typesafe/jev-1.13 or jev-latest. */
    model?: string;
    /** System One endpoint URL override. */
    endpoint?: string;
    /** Bearer token override; resolved from settings when omitted. */
    apiKey?: string;
    /** Request timeout in milliseconds. @default 8000 @minimum 500 @maximum 60000 */
    timeoutMs?: number;
    /** Retry attempts for 429 and 5xx responses. @default 2 @minimum 0 @maximum 5 */
    retries?: number;
}): Promise<{
    answers: Record<string, types.jev.Answer>;
    model: string;
    usage: { inputTokens: number; outputTokens: number; cost: number | null };
    latencyMs: number;
}> {
    const out = await ctx.fns.decision.ask({
        state: opts.state,
        questions: opts.questions as Record<string, types.decision.Question>,
        engine: "jev",
        ...(opts.model === undefined ? {} : { model: opts.model }),
        ...(opts.endpoint === undefined ? {} : { endpoint: opts.endpoint }),
        ...(opts.apiKey === undefined ? {} : { apiKey: opts.apiKey }),
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
        ...(opts.retries === undefined ? {} : { retries: opts.retries }),
    });
    return {
        answers: out.answers as Record<string, types.jev.Answer>,
        model: out.model,
        usage: out.usage,
        latencyMs: out.latencyMs,
    };
}
