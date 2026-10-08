// Shared transport for decision engines: one POST, bounded by a timeout,
// retried only on 429 and 5xx. A 4xx is our own malformed request and retrying
// cannot fix it, so it is raised immediately.

/** Posts a JSON decision request with a timeout and retries limited to 429 and 5xx responses. */
/**
 * Send one JSON body to a decision endpoint and return the parsed response with its latency.
 *
 * Use from a decision engine implementation, not from application code: call sites
 * should go through decision.ask, which picks the engine and normalizes the payload.
 * Honours a retry-after header, gives up after the configured attempts, and throws
 * on a 4xx because a malformed request will fail identically on every retry.
 *
 * @param opts.url Decision endpoint receiving the POST.
 * @param opts.apiKey Bearer token sent in the authorization header.
 * @param opts.body Request payload serialized as the JSON body.
 * @param opts.label Prefix for thrown error messages, such as the engine name.
 * @param opts.timeoutMs Abort each attempt after this many milliseconds.
 * @param opts.retries Extra attempts for 429 and 5xx responses.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Full URL of the decision endpoint. */
    url: string;
    /** Bearer token for the authorization header. */
    apiKey: string;
    /** Payload sent as the JSON request body. */
    body: Record<string, unknown>;
    /** Error-message prefix identifying the caller, such as "decision.engineOpenai". */
    label: string;
    /** Per-attempt timeout in milliseconds. @default 8000 @minimum 500 @maximum 60000 */
    timeoutMs?: number;
    /** Retry attempts for 429 and 5xx responses. @default 2 @minimum 0 @maximum 5 */
    retries?: number;
}): Promise<{ json: any; latencyMs: number }> {
    const timeoutMs = Math.min(60000, Math.max(500, opts.timeoutMs ?? 8000));
    const retries = Math.min(5, Math.max(0, opts.retries ?? 2));
    const body = JSON.stringify(opts.body);

    let lastError = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(opts.url, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
                body,
                signal: controller.signal,
            });
            const latencyMs = Date.now() - startedAt;
            const text = await res.text();
            if (!res.ok) {
                if (res.status !== 429 && res.status < 500) {
                    throw new Error(`${opts.label}: ${res.status} ${text.slice(0, 300)}`);
                }
                lastError = `${res.status} ${text.slice(0, 200)}`;
                if (attempt === retries) break;
                const after = Number(res.headers.get("retry-after"));
                await Bun.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 400 * (attempt + 1));
                continue;
            }
            const json: any = JSON.parse(text);
            if (json?.error) throw new Error(`${opts.label}: ${JSON.stringify(json.error).slice(0, 300)}`);
            return { json, latencyMs };
        } catch (error: any) {
            if (error?.name === "AbortError") {
                lastError = `timeout after ${timeoutMs}ms`;
                if (attempt === retries) continue;
                continue;
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`${opts.label}: giving up after ${retries + 1} attempts: ${lastError}`);
}
