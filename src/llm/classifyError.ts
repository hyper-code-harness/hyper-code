// The single place where a raw provider failure becomes a decision.
//
// The distinction that matters is subscription quota vs everything else. A
// subscription 429 ("usage_limit_reached") means a fixed window is spent: no
// amount of retrying, and no amount of money, brings it back before resets_at.
// A pay-per-token 429 is short throttling and stays an ordinary retry. Mixing
// the two is what makes a spent Codex plan cost ~8 pointless HTTP calls per
// agent and paint a red error badge that suggests something is broken.
/** Turns a failed LLM provider response into an actionable failure kind. */
/**
 * Classify a failed LLM provider response into an actionable failure kind.
 *
 * Reads the HTTP status, the response body and the rate-limit headers and
 * returns what the caller should DO: park until the quota resets, retry after a
 * delay, or fail loudly. Use it in stream implementations before deciding to
 * retry, and in the worker loop before deciding to reschedule.
 *
 * @param opts.provider Provider name from llm.resolveEndpoint, e.g. "codex".
 * @param opts.account Credential account within the provider.
 * @param opts.kind Provider billing kind; subscription providers can be parked.
 * @param opts.status HTTP status code of the failed response.
 * @param opts.body Raw response body text, JSON or plain.
 * @param opts.headers Response headers, if available.
 * @param opts.now Current time in ms, for testing.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider name as returned by llm.resolveEndpoint. */
        provider: string;
        /** Credential account within the provider. @default "default" */
        account?: string;
        /** Billing kind of the provider; only "subscription" can be parked. @default "api" */
        kind?: "subscription" | "api" | "local";
        /** HTTP status code of the failed response. @minimum 0 @maximum 599 */
        status?: number;
        /** Raw response body text. */
        body?: string;
        /** Response headers of the failed request. */
        headers?: Headers | Record<string, string> | null;
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): types.llm.FailureInfo {
    const provider = opts.provider;
    const account = opts.account ?? "default";
    const kind = opts.kind ?? "api";
    const status = Number(opts.status ?? 0);
    const body = String(opts.body ?? "");
    const now = opts.now ?? Date.now();
    const header = headerReader(opts.headers);

    const parsed = safeJson(body);
    const err = parsed?.error ?? parsed ?? null;
    const code = String(err?.type ?? err?.code ?? "");
    const serverMessage = typeof err?.message === "string" ? err.message : "";

    // Anthropic and OpenAI both use Retry-After; it is a directive, not a hint.
    const retryAfterMs = parseRetryAfter(header("retry-after"), now);

    // ---- quota exhausted on a subscription -------------------------------
    const quotaCode = /usage_limit_reached|usage_not_included|quota_exceeded|credits_depleted/i.test(code);
    const quotaText = /usage limit (?:has been )?reached|out of credits|quota exceeded/i.test(serverMessage || body);
    // A generic `rate_limit_error` with no quota fields is ordinary throttling,
    // even for subscription credentials. Anthropic can emit it transiently
    // while `/api/oauth/usage` still reports plenty of quota. Park only when
    // the provider explicitly identifies exhausted usage/credits.
    if (kind === "subscription" && (quotaCode || quotaText)) {
        const resetsAt = subscriptionResetsAt(err, header, now);
        const planType = typeof err?.plan_type === "string" ? err.plan_type : undefined;
        return {
            kind: "usage_limit",
            provider,
            account,
            planType,
            resetsAt,
            status: status || undefined,
            retryable: false,
            message: usageLimitMessage(provider, planType, resetsAt, now),
            raw: body.slice(0, 2000),
        };
    }

    // ---- pay-per-token account with no money left ------------------------
    // Retrying cannot help and the server never says when, so this is fatal
    // rather than a rate limit: the user has to top up or switch provider.
    if (/insufficient_quota|billing_hard_limit_reached|billing_not_active/i.test(code + " " + serverMessage)) {
        return {
            kind: "fatal",
            provider,
            account,
            status: status || undefined,
            retryable: false,
            message: `${provider}: account balance depleted — add funds or switch models`,
            raw: body.slice(0, 2000),
        };
    }

    // ---- ordinary throttling ---------------------------------------------
    if (status === 429 || /rate.?limit/i.test(code + " " + serverMessage)) {
        return {
            kind: "rate_limit",
            provider,
            account,
            status: status || undefined,
            retryAfterMs: retryAfterMs ?? 5_000,
            retryable: true,
            message: `${provider}: rate limited (429) — retry in ${Math.round((retryAfterMs ?? 5_000) / 1000)}s`,
            raw: body.slice(0, 2000),
        };
    }

    // ---- credentials ------------------------------------------------------
    if (status === 401 || status === 403 || /invalid_api_key|authentication_error|unauthorized/i.test(code)) {
        return {
            kind: "auth",
            provider,
            account,
            status: status || undefined,
            retryable: false,
            message: `${provider}/${account}: authorization rejected — update the key or sign in again`,
            raw: body.slice(0, 2000),
        };
    }

    // ---- context window ---------------------------------------------------
    if (status === 413 || /context_length_exceeded|request_too_large|prompt is too long|exceeds the context window|exceeded model token limit/i.test(code + " " + serverMessage + " " + body)) {
        return {
            kind: "overflow",
            provider,
            account,
            status: status || undefined,
            retryable: false,
            message: `${provider}: request exceeds the context window — compaction required`,
            raw: body.slice(0, 2000),
        };
    }

    // ---- transport / server ----------------------------------------------
    if ((status >= 500 && status <= 599) || status === 408
        || /upstream\s+connect|connection\s+(?:was\s+)?(?:reset|termination|refused|closed)|service\s+unavailable|overloaded|stalled|ETIMEDOUT|ECONNRESET|timed? ?out|network/i.test(body + " " + serverMessage)) {
        return {
            kind: "transient",
            provider,
            account,
            status: status || undefined,
            retryAfterMs: retryAfterMs ?? 1_000,
            retryable: true,
            message: `${provider}: temporary failure${status ? ` (${status})` : ""} — retry`,
            raw: body.slice(0, 2000),
        };
    }

    return {
        kind: "fatal",
        provider,
        account,
        status: status || undefined,
        retryable: false,
        message: serverMessage
            ? `${provider}${status ? ` ${status}` : ""}: ${serverMessage.slice(0, 300)}`
            : `${provider}${status ? ` ${status}` : ""}: ${body.slice(0, 300) || "unknown error"}`,
        raw: body.slice(0, 2000),
    };
}

function headerReader(headers: Headers | Record<string, string> | null | undefined) {
    return (name: string): string | null => {
        if (!headers) return null;
        if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
        const bag = headers as Record<string, string>;
        return bag[name] ?? bag[name.toLowerCase()] ?? null;
    };
}

function safeJson(text: string): any {
    try { return JSON.parse(text); } catch { return null; }
}

// Retry-After is either delta-seconds or an HTTP date.
function parseRetryAfter(value: string | null, now: number): number | null {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

// Every subscription backend states the reset moment somewhere. Codex puts it
// in the error body, Anthropic in the unified rate-limit headers. When nothing
// says it, an hour is the honest conservative guess — recorded as such by the
// caller rather than presented as fact.
function subscriptionResetsAt(err: any, header: (n: string) => string | null, now: number): number | null {
    const secs = Number(err?.resets_at);
    if (Number.isFinite(secs) && secs > 0) return Math.round(secs * 1000);
    const inSecs = Number(err?.resets_in_seconds);
    if (Number.isFinite(inSecs) && inSecs > 0) return now + Math.round(inSecs * 1000);
    for (const name of ["anthropic-ratelimit-unified-5h-reset", "anthropic-ratelimit-unified-7d-reset", "anthropic-ratelimit-unified-reset"]) {
        const raw = header(name);
        const value = Number(raw);
        if (Number.isFinite(value) && value > 0) return Math.round(value * 1000);
        const at = raw ? Date.parse(raw) : NaN;
        if (Number.isFinite(at)) return at;
    }
    return null;
}

function usageLimitMessage(provider: string, planType: string | undefined, resetsAt: number | null, now: number): string {
    const plan = planType ? ` (plan ${planType})` : "";
    if (!resetsAt) return `Subscription limit for ${provider}${plan} exhausted. Reset time unknown.`;
    const left = Math.max(0, resetsAt - now);
    const hours = Math.floor(left / 3_600_000);
    const days = Math.floor(hours / 24);
    const human = days >= 1 ? `${days}d ${hours % 24}h` : hours >= 1 ? `${hours}h ${Math.floor((left % 3_600_000) / 60_000)}m` : `${Math.ceil(left / 60_000)}m`;
    return `Subscription limit for ${provider}${plan} exhausted. Quota resets at ${new Date(resetsAt).toLocaleString()} (in ${human}).`;
}
