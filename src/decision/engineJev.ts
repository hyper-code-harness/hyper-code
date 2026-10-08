// Jev System One engine. The wire contract is POST /systemone with
// { model, state, questions } where questions is a map keyed by question id and
// answers come back under the same ids — so the translation is almost identity,
// except that the portable "predicate" alias is renamed to Jev's "noul".

/** Evaluates portable decision questions through the Jev System One endpoint. */
/**
 * Run one decision round trip against a Jev System One endpoint and return
 * engine-neutral answers.
 *
 * Use through decision.ask rather than directly; call it here only when a caller
 * must pin the Jev backend regardless of the configured default, for example a
 * benchmark comparing engines on the same questions. Text only: Jev has no image
 * input, so pass evidence as a string or JSON structure.
 *
 * @param opts.state Evidence every question is evaluated against.
 * @param opts.questions Question id to portable typed question.
 * @param opts.model Model id override; defaults to the jev.model setting.
 * @param opts.endpoint System One URL override; defaults to the jev.endpoint setting.
 * @param opts.apiKey Bearer token override; defaults to the OpenRouter or TypeSafe key.
 * @param opts.timeoutMs Abort each attempt after this many milliseconds.
 * @param opts.retries Retries on 429 and 5xx, honouring retry-after.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Evidence evaluated by every question: text, a record, or a list. */
    state: string | Record<string, unknown> | unknown[];
    /** Map of caller-chosen question id to portable typed question. */
    questions: Record<string, types.decision.Question>;
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
}): Promise<types.decision.Result> {
    const endpoint = opts.endpoint
        ?? (await ctx.fns.settings.getString({ module: "jev", scopeType: "global", key: "endpoint" }))
        ?? "https://openrouter.ai/api/v1/systemone";
    const model = opts.model
        ?? (await ctx.fns.settings.getString({ module: "jev", scopeType: "global", key: "model" }))
        ?? "typesafe/jev-1.13";

    const keySetting = endpoint.includes("openrouter.ai")
        ? { module: "llm", key: "openrouterApiKey" }
        : { module: "jev", key: "apiKey" };
    const apiKey = opts.apiKey
        ?? await ctx.fns.secrets.resolveSetting({ module: keySetting.module, scopeType: "global", key: keySetting.key });
    if (!apiKey) throw new Error(`decision.engineJev: no API key; set ${keySetting.module}.${keySetting.key}`);

    // Jev names the yes/no primitive "noul"; the portable contract also accepts "predicate".
    const questions: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(opts.questions)) {
        questions[id] = q.type === "predicate" ? { ...q, type: "noul" } : q;
    }

    const { json, latencyMs } = await ctx.fns.decision.post({
        url: endpoint,
        apiKey,
        body: { model, state: opts.state, questions },
        label: "decision.engineJev",
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
        ...(opts.retries === undefined ? {} : { retries: opts.retries }),
    });

    const answers: Record<string, types.decision.Answer> = {};
    for (const [id, raw] of Object.entries((json?.answers ?? {}) as Record<string, any>)) {
        if (raw?.type === "noul" || typeof raw?.noul === "number") {
            const p = Number(raw.noul);
            answers[id] = { type: "noul", noul: p, probability: p };
        } else if (raw?.type === "score") {
            answers[id] = {
                type: "score",
                score: Number(raw.score ?? 0),
                ...(raw.legend ? { legend: raw.legend as string[] } : {}),
                probabilities: (raw.probabilities ?? {}) as Record<string, number>,
                confidence: Number(raw.confidence ?? 0),
            };
        } else {
            answers[id] = {
                type: "choice",
                choice: String(raw?.choice ?? ""),
                probabilities: (raw?.probabilities ?? {}) as Record<string, number>,
                confidence: Number(raw?.confidence ?? 0),
            };
        }
    }

    const usage = json?.usage ?? {};
    return {
        answers,
        engine: "jev",
        model: String(json?.model ?? model),
        usage: {
            inputTokens: Number(usage.input_tokens ?? 0),
            outputTokens: Number(usage.output_tokens ?? 0),
            cost: typeof usage.cost === "number" ? usage.cost : null,
        },
        latencyMs,
    };
}
