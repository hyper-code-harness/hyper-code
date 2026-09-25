// Single HTTP boundary for Jev. Every other jev.* function composes this one.
//
// Jev is not a chat model: it never reaches llm.call, has no messages, and
// returns typed values instead of text. The wire contract is POST /systemone
// with { model, state, questions } and answers keyed by the same question ids.

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
    const ids = Object.keys(opts.questions ?? {});
    if (ids.length === 0) throw new Error("jev.decide: questions must not be empty");
    for (const id of ids) {
        const q: any = (opts.questions as any)[id];
        if (q?.type === "choice") {
            const n = Object.keys(q.criteria ?? {}).length;
            if (n < 2) throw new Error(`jev.decide: choice question "${id}" needs at least 2 options`);
            if (n > 255) throw new Error(`jev.decide: choice question "${id}" has ${n} options, the limit is 255`);
        }
    }

    const endpoint = opts.endpoint
        ?? (await ctx.fns.settings.getString({ module: "jev", scopeType: "global", key: "endpoint" }))
        ?? "https://openrouter.ai/api/v1/systemone";
    const model = opts.model
        ?? (await ctx.fns.settings.getString({ module: "jev", scopeType: "global", key: "model" }))
        ?? "typesafe/jev-1.13";

    // OpenRouter serves Jev behind the same credential as every other route,
    // so reuse it rather than asking the user for a second key.
    const keySetting = endpoint.includes("openrouter.ai")
        ? { module: "llm", key: "openrouterApiKey" }
        : { module: "jev", key: "apiKey" };
    const apiKey = opts.apiKey
        ?? await ctx.fns.secrets.resolveSetting({ module: keySetting.module, scopeType: "global", key: keySetting.key });
    if (!apiKey) throw new Error(`jev.decide: no API key; set ${keySetting.module}.${keySetting.key}`);

    const timeoutMs = Math.min(60000, Math.max(500, opts.timeoutMs ?? 8000));
    const retries = Math.min(5, Math.max(0, opts.retries ?? 2));
    const body = JSON.stringify({ model, state: opts.state, questions: opts.questions });

    let lastError = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
                body,
                signal: controller.signal,
            });
            const latencyMs = Date.now() - startedAt;
            const text = await res.text();
            if (!res.ok) {
                // 4xx other than 429 is our own bad request: retrying cannot fix it.
                if (res.status !== 429 && res.status < 500) {
                    throw new Error(`jev.decide: ${res.status} ${text.slice(0, 300)}`);
                }
                lastError = `${res.status} ${text.slice(0, 200)}`;
                if (attempt === retries) break;
                const after = Number(res.headers.get("retry-after"));
                await Bun.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 400 * (attempt + 1));
                continue;
            }
            const json: any = JSON.parse(text);
            if (json?.error) throw new Error(`jev.decide: ${JSON.stringify(json.error).slice(0, 300)}`);
            const usage = json?.usage ?? {};
            return {
                answers: (json?.answers ?? {}) as Record<string, types.jev.Answer>,
                model: String(json?.model ?? model),
                usage: {
                    inputTokens: Number(usage.input_tokens ?? 0),
                    outputTokens: Number(usage.output_tokens ?? 0),
                    cost: typeof usage.cost === "number" ? usage.cost : null,
                },
                latencyMs,
            };
        } catch (error: any) {
            if (error?.name === "AbortError") {
                lastError = `timeout after ${timeoutMs}ms`;
                if (attempt === retries) break;
                continue;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`jev.decide: giving up after ${retries + 1} attempts: ${lastError}`);
}
