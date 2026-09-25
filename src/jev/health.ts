// Cheapest possible end-to-end probe: one noul over a three-word state.

/** Verifies Jev connectivity by sending one trivial question and reporting endpoint, model and latency. */
/**
 * Check that the configured Jev endpoint, credential and model actually answer.
 *
 * Use before enabling a Jev-backed call site, after changing the endpoint setting,
 * or when decisions start failing and it is unclear whether the cause is the
 * credential, the route or the request shape. Never throws: a failure is reported
 * as ok false with the reason, so it is safe to call from a status panel.
 *
 * @param opts.timeoutMs Abort the probe after this many milliseconds.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Probe timeout in milliseconds. @default 5000 @minimum 500 @maximum 30000 */
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    endpoint: string;
    model: string;
    resolvedModel: string | null;
    hasKey: boolean;
    latencyMs: number | null;
    error: string | null;
}> {
    const endpoint = (await ctx.fns.settings.getString({ module: "jev", scopeType: "global", key: "endpoint" }))
        ?? "https://openrouter.ai/api/v1/systemone";
    const model = (await ctx.fns.settings.getString({ module: "jev", scopeType: "global", key: "model" }))
        ?? "typesafe/jev-1.13";
    const keyModule = endpoint.includes("openrouter.ai") ? "llm" : "jev";
    const keyName = endpoint.includes("openrouter.ai") ? "openrouterApiKey" : "apiKey";
    const key = await ctx.fns.secrets.resolveSetting({ module: keyModule, scopeType: "global", key: keyName });

    if (!key) {
        return { ok: false, endpoint, model, resolvedModel: null, hasKey: false, latencyMs: null, error: `no API key at ${keyModule}.${keyName}` };
    }
    try {
        const out = await ctx.fns.jev.decide({
            state: "ping",
            questions: { alive: { type: "noul", instructions: "Is this text in English?" } },
            timeoutMs: opts.timeoutMs ?? 5000,
            retries: 0,
        });
        return { ok: true, endpoint, model, resolvedModel: out.model, hasKey: true, latencyMs: out.latencyMs, error: null };
    } catch (error: any) {
        return { ok: false, endpoint, model, resolvedModel: null, hasKey: true, latencyMs: null, error: String(error?.message ?? error) };
    }
}
