// OpenAI Decisions engine. The wire contract is POST /v1/decisions with
// { model, input, questions: [...] } where each question carries its own `name`
// and answers come back as an array, so the translation is: map -> array on the
// way out, array -> map on the way back. The yes/no primitive is "predicate"
// and its result field is `probability`; choices and score levels are objects
// instead of the rubric records Jev takes.
//
// Only input tokens are billed here: no output, cache-read or cache-write charge.

/** Evaluates portable decision questions through the OpenAI Decisions API, with optional images. */
/**
 * Run one decision round trip against the OpenAI /v1/decisions endpoint and return
 * engine-neutral answers.
 *
 * Use through decision.ask rather than directly; reach for it explicitly when the
 * decision needs image evidence, Zero Data Retention or regional processing, which
 * the Jev engine cannot provide. Images must be inline base64: hosted URLs and
 * file ids are rejected by the endpoint.
 *
 * A question the model refuses is reported as a yes/no answer with probability 0,
 * so a caller can treat a refusal as "condition not established" instead of crashing.
 *
 * @param opts.state Evidence every question is evaluated against.
 * @param opts.questions Question id to portable typed question.
 * @param opts.images Inline base64 images added to the evidence.
 * @param opts.model Model id override; defaults to the decision.openaiModel setting.
 * @param opts.endpoint Endpoint override; defaults to the decision.openaiEndpoint setting.
 * @param opts.apiKey Bearer token override; defaults to the llm.openaiApiKey secret.
 * @param opts.timeoutMs Abort each attempt after this many milliseconds.
 * @param opts.retries Retries on 429 and 5xx, honouring retry-after.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Evidence evaluated by every question: text, a record, or a list. */
    state: string | Record<string, unknown> | unknown[];
    /** Map of caller-chosen question id to portable typed question. */
    questions: Record<string, types.decision.Question>;
    /** Inline base64 images, either a full data URL or bare base64 assumed to be PNG. */
    images?: string[];
    /** Model id override, such as gpt-6-luna. */
    model?: string;
    /** Decisions endpoint URL override. */
    endpoint?: string;
    /** Bearer token override; resolved from llm.openaiApiKey when omitted. */
    apiKey?: string;
    /** Request timeout in milliseconds. @default 8000 @minimum 500 @maximum 60000 */
    timeoutMs?: number;
    /** Retry attempts for 429 and 5xx responses. @default 2 @minimum 0 @maximum 5 */
    retries?: number;
}): Promise<types.decision.Result> {
    const endpoint = opts.endpoint
        ?? (await ctx.fns.settings.getString({ module: "decision", scopeType: "global", key: "openaiEndpoint" }))
        ?? "https://api.openai.com/v1/decisions";
    const model = opts.model
        ?? (await ctx.fns.settings.getString({ module: "decision", scopeType: "global", key: "openaiModel" }))
        ?? "gpt-6-luna";
    const apiKey = opts.apiKey
        ?? await ctx.fns.secrets.resolveSetting({ module: "llm", scopeType: "global", key: "openaiApiKey" });
    if (!apiKey) throw new Error("decision.engineOpenai: no API key; set llm.openaiApiKey");

    const asText = (value: unknown): string => typeof value === "string" ? value : JSON.stringify(value);
    const text = asText(opts.state);

    // A bare string is the cheapest input; images force the message form.
    const images = opts.images ?? [];
    const input: unknown = images.length === 0 ? text : [{
        role: "user",
        content: [
            { type: "input_text", text },
            ...images.map((image) => ({
                type: "input_image",
                image_url: image.startsWith("data:") ? image : `data:image/png;base64,${image}`,
            })),
        ],
    }];

    const ids = Object.keys(opts.questions);
    const questions = ids.map((id) => {
        const q = opts.questions[id]!;
        const instructions = asText(q.instructions);
        if (q.type === "choice") {
            return {
                type: "choice",
                name: id,
                instructions,
                choices: Object.entries(q.criteria).map(([value, description]) => ({
                    value,
                    ...(description === null || description === undefined ? {} : { description: asText(description) }),
                })),
            };
        }
        if (q.type === "score") {
            return {
                type: "score",
                name: id,
                instructions,
                levels: q.criteria.map((level, index) => ({
                    label: level === null || level === undefined ? `level ${index}` : asText(level),
                })),
            };
        }
        const criteria = q.criteria;
        const suffix = criteria?.true || criteria?.false
            ? ` Yes means: ${criteria.true ?? "the condition holds"}. No means: ${criteria.false ?? "it does not"}.`
            : "";
        return { type: "predicate", name: id, instructions: instructions + suffix };
    });

    const { json, latencyMs } = await ctx.fns.decision.post({
        url: endpoint,
        apiKey,
        body: { model, input, questions },
        label: "decision.engineOpenai",
        ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
        ...(opts.retries === undefined ? {} : { retries: opts.retries }),
    });

    const answers: Record<string, types.decision.Answer> = {};
    for (const raw of (json?.answers ?? []) as any[]) {
        const id = String(raw?.name ?? "");
        if (!id) continue;
        if (raw.type === "predicate") {
            const p = Number(raw.probability ?? 0);
            answers[id] = { type: "noul", noul: p, probability: p };
        } else if (raw.type === "choice") {
            const probabilities: Record<string, number> = {};
            for (const p of (raw.probabilities ?? []) as any[]) probabilities[String(p.value)] = Number(p.probability ?? 0);
            answers[id] = {
                type: "choice",
                choice: String(raw.choice ?? ""),
                probabilities,
                confidence: Number(raw.confidence ?? 0),
            };
        } else if (raw.type === "score") {
            const probabilities: Record<string, number> = {};
            const legend: string[] = [];
            for (const p of (raw.probabilities ?? []) as any[]) {
                probabilities[String(p.value)] = Number(p.probability ?? 0);
                legend.push(String(p.label ?? p.value));
            }
            answers[id] = {
                type: "score",
                score: Number(raw.score ?? 0),
                legend,
                probabilities,
                confidence: Number(raw.confidence ?? 0),
            };
        } else {
            // A refusal carries no value: report it as an unestablished condition.
            answers[id] = { type: "noul", noul: 0, probability: 0 };
        }
    }

    const usage = json?.usage ?? {};
    const inputTokens = Number(usage.input_tokens ?? 0);
    return {
        answers,
        engine: "openai",
        model: String(json?.model ?? model),
        usage: {
            inputTokens,
            outputTokens: Number(usage.output_tokens ?? 0),
            // Published beta rate: $0.10 per 1M input tokens, output and cache free.
            cost: inputTokens > 0 ? inputTokens * 1e-7 : null,
        },
        latencyMs,
    };
}
