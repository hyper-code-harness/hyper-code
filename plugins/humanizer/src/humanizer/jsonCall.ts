// One LLM call that must return JSON, with a repair retry.
// ctx.fns.humanizer.jsonCall({ system, user }) → { data, model, attempts }

/**
 * Runs one LLM request that must return a JSON object, retrying once when the provider returns unparseable output.
 *
 * Use inside the humanizer step functions instead of calling llm.call directly, so a
 * single malformed or truncated structured response does not fail the whole pipeline:
 * the first attempt asks for JSON, a retry repeats the request with an explicit repair
 * instruction, and only then does the call throw. Strips Markdown code fences before
 * parsing. Returns the parsed object as `data` together with the number of attempts used.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** System instruction, including the JSON shape the model must return. */
    system: string;
    /** User message content. */
    user: string;
    /** Provider-qualified model override; defaults to the configured model. */
    model?: string;
    /** Maximum output tokens. @default 2000 @minimum 200 @maximum 16000 */
    maxTokens?: number;
    /** Attempts before throwing. @default 2 @minimum 1 @maximum 4 */
    attempts?: number;
    /** Name used in the error message, such as "humanizer.facts". */
    label?: string;
}): Promise<{
    data: Record<string, any>;
    model: string;
    attempts: number;
}> {
    const label = opts.label ?? "humanizer.jsonCall";
    const maxAttempts = Math.max(1, Math.min(opts.attempts ?? 2, 4));
    let lastText = "";
    let lastErr = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const system = attempt === 1
            ? opts.system
            : `${opts.system}\n\nYour previous reply was not valid JSON (${lastErr}). Return ONLY the JSON object, with no prose, no code fence and no trailing commas.`;
        const res = await ctx.fns.llm.call({
            user: opts.user,
            system,
            model: opts.model,
            max_tokens: opts.maxTokens ?? 2000,
            response_format: { type: "json_object" },
        });
        lastText = (res.text ?? "").trim();
        const cleaned = lastText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        try {
            const data = JSON.parse(cleaned);
            if (data && typeof data === "object") {
                return { data, model: res.model ?? opts.model ?? "default", attempts: attempt };
            }
            lastErr = "parsed value was not an object";
        } catch (e: any) {
            lastErr = String(e?.message ?? e).slice(0, 120);
        }
    }
    throw new Error(`${label}: model did not return JSON after ${maxAttempts} attempt(s) (${lastErr}): ${lastText.slice(0, 200)}`);
}
