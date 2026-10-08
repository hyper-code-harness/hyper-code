// The one entry point application code should call. It validates the portable
// question contract once, picks an engine, and returns answers whose shape does
// not depend on which backend answered.
//
// Engine selection order: explicit opts.engine, then the decision.engine setting,
// then jev — the cheapest. Passing images selects openai automatically, because
// Jev is text only and would silently ignore them.

/** Evaluates typed questions against shared evidence through the configured decision engine. */
/**
 * Ask a decision engine one or more typed questions about shared evidence and
 * receive constrained answers with calibrated probabilities instead of text.
 *
 * Use when code needs a fast, structured judgment it can branch on: classification,
 * routing, scoring, detection, reranking or verification. All questions are evaluated
 * in parallel against the same evidence in one round trip, so send every question the
 * caller might need — extra questions cost input tokens, not latency. Prefer several
 * small questions combined in code over one compound question.
 *
 * Not for generating text, arithmetic, date math or counting; keep those in code.
 * Throws on transport or provider failure so each caller can choose its own fallback.
 *
 * @param opts.state Evidence the questions are evaluated against.
 * @param opts.questions Question id to typed question; answers return under the same ids.
 * @param opts.images Inline base64 images; supported only by the openai engine, which is selected automatically when present.
 * @param opts.engine Backend override; defaults to the decision.engine setting.
 * @param opts.model Model id override passed to the selected engine.
 * @param opts.endpoint Endpoint URL override passed to the selected engine.
 * @param opts.apiKey Bearer token override passed to the selected engine.
 * @param opts.timeoutMs Abort each attempt after this many milliseconds.
 * @param opts.retries Retries on 429 and 5xx, honouring retry-after.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Evidence evaluated by every question: text, a record, or a list. */
    state: string | Record<string, unknown> | unknown[];
    /** Map of caller-chosen question id to typed question. */
    questions: Record<string, types.decision.Question>;
    /** Inline base64 images added to the evidence; forces the openai engine. */
    images?: string[];
    /** Decision backend to use instead of the configured default. */
    engine?: types.decision.Engine;
    /** Model id override, such as typesafe/jev-1.13 or gpt-6-luna. */
    model?: string;
    /** Endpoint URL override for the selected engine. */
    endpoint?: string;
    /** Bearer token override for the selected engine. */
    apiKey?: string;
    /** Request timeout in milliseconds. @default 8000 @minimum 500 @maximum 60000 */
    timeoutMs?: number;
    /** Retry attempts for 429 and 5xx responses. @default 2 @minimum 0 @maximum 5 */
    retries?: number;
}): Promise<types.decision.Result> {
    const ids = Object.keys(opts.questions ?? {});
    if (ids.length === 0) throw new Error("decision.ask: questions must not be empty");
    for (const id of ids) {
        const q = opts.questions[id]!;
        if (q.type === "choice") {
            const n = Object.keys(q.criteria ?? {}).length;
            if (n < 2) throw new Error(`decision.ask: choice question "${id}" needs at least 2 options`);
            if (n > 255) throw new Error(`decision.ask: choice question "${id}" has ${n} options, the limit is 255`);
        }
        if (q.type === "score" && (q.criteria ?? []).length < 2) {
            throw new Error(`decision.ask: score question "${id}" needs at least 2 levels`);
        }
    }

    const configured = await ctx.fns.settings.getString({ module: "decision", scopeType: "global", key: "engine" });
    // Images are the one hard capability difference: Jev would drop them silently.
    const engine: types.decision.Engine = (opts.images?.length ?? 0) > 0
        ? "openai"
        : opts.engine ?? (configured === "openai" ? "openai" : "jev");

    const shared = {
        state: opts.state,
        questions: opts.questions,
        ...(opts.model === undefined ? {} : { model: opts.model }),
        ...(opts.endpoint === undefined ? {} : { endpoint: opts.endpoint }),
        ...(opts.apiKey === undefined ? {} : { apiKey: opts.apiKey }),
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
        ...(opts.retries === undefined ? {} : { retries: opts.retries }),
    };

    return engine === "openai"
        ? await ctx.fns.decision.engineOpenai({ ...shared, ...(opts.images?.length ? { images: opts.images } : {}) })
        : await ctx.fns.decision.engineJev(shared);
}
