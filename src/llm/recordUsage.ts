// Subscription providers report how much of the window is spent on EVERY
// successful response — Anthropic in unified rate-limit headers, Codex in
// x-codex-primary-used-percent and the rate_limits stream event. Nobody was
// reading it, so the wall was always a surprise. This records the snapshot as a
// side effect of work already being done: no extra request is ever made for it.
/** Records a subscription quota snapshot from a provider response. */
/**
 * Store the remaining subscription quota reported by a provider response.
 *
 * Reads Anthropic's unified rate-limit headers and Codex's percent header or
 * rate_limits stream payload, and keeps the latest snapshot per credential in
 * kv under "llm:usage:<provider>:<account>". Call it after a successful call,
 * and from the usage-limit path with spent=true.
 *
 * @param opts.provider Provider name from llm.resolveEndpoint.
 * @param opts.account Credential account within the provider.
 * @param opts.headers Response headers of the successful call.
 * @param opts.rateLimits Codex rate_limits payload from the response stream.
 * @param opts.spent Force the snapshot to 100% — the quota just ran out.
 * @param opts.resetsAt Known reset moment in ms, used with spent.
 * @param opts.planType Subscription plan name reported by the provider.
 * @param opts.now Current time in ms, for testing.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider name, e.g. "codex". */
        provider: string;
        /** Credential account within the provider. @default "default" */
        account?: string;
        /** Response headers to read the quota from. */
        headers?: Headers | Record<string, string> | null;
        /** Codex rate_limits payload: { primary, secondary } windows. */
        rateLimits?: any;
        /** Record the window as fully spent. @default false */
        spent?: boolean;
        /** Reset moment in ms, when known from an error body. */
        resetsAt?: number | null;
        /** Plan name reported by the provider, e.g. "prolite". */
        planType?: string | null;
        /** Codex reset-credit summary reported by the usage endpoint. */
        resetCredits?: types.llm.UsageSnapshot["resetCredits"];
        /** Current timestamp in ms; defaults to Date.now(). */
        now?: number;
    },
): Promise<types.llm.UsageSnapshot | null> {
    const provider = opts.provider;
    const account = opts.account ?? "default";
    const now = opts.now ?? Date.now();
    const header = headerReader(opts.headers);

    const windows: types.llm.UsageSnapshot["windows"] = {};
    let source: types.llm.UsageSnapshot["source"] = "headers";

    // Anthropic: two rolling windows as fractions plus their reset seconds.
    // Number(null) is 0, so a missing header must be rejected BEFORE parsing —
    // otherwise every provider silently reports a comfortable 0% used.
    for (const [key, abbrev] of [["primary", "5h"], ["secondary", "7d"]] as const) {
        const rawUsed = header(`anthropic-ratelimit-unified-${abbrev}-utilization`);
        const rawReset = header(`anthropic-ratelimit-unified-${abbrev}-reset`);
        const used = rawUsed == null ? NaN : Number(rawUsed);
        const reset = rawReset == null ? NaN : Number(rawReset);
        if (Number.isFinite(used)) {
            windows[key] = {
                usedPercent: clampPercent(used * 100),
                windowMinutes: abbrev === "5h" ? 300 : 10080,
                resetsAt: Number.isFinite(reset) && reset > 0 ? Math.round(reset * 1000) : null,
            };
        }
    }

    // xAI exposes per-minute token/request capacity separately from the real
    // SuperGrok weekly allowance. Keep parsing this as a fallback diagnostic,
    // but refreshUsage replaces it with the authoritative billing snapshot.
    const xaiTokenLimit = Number(header("x-ratelimit-limit-tokens"));
    const xaiTokenRemaining = Number(header("x-ratelimit-remaining-tokens"));
    const xaiRequestLimit = Number(header("x-ratelimit-limit-requests"));
    const xaiRequestRemaining = Number(header("x-ratelimit-remaining-requests"));
    const xaiTokenUsed = Number.isFinite(xaiTokenLimit) && xaiTokenLimit > 0 && Number.isFinite(xaiTokenRemaining)
        ? (1 - xaiTokenRemaining / xaiTokenLimit) * 100 : NaN;
    const xaiRequestUsed = Number.isFinite(xaiRequestLimit) && xaiRequestLimit > 0 && Number.isFinite(xaiRequestRemaining)
        ? (1 - xaiRequestRemaining / xaiRequestLimit) * 100 : NaN;
    const xaiUsed = Math.max(Number.isFinite(xaiTokenUsed) ? xaiTokenUsed : -1, Number.isFinite(xaiRequestUsed) ? xaiRequestUsed : -1);
    if (provider === "xai" && xaiUsed >= 0) {
        windows.primary = { usedPercent: clampPercent(xaiUsed), windowMinutes: 1, resetsAt: null };
    }


    // Codex: a bare percent header, superseded by the richer stream payload.
    const rawCodex = header("x-codex-primary-used-percent");
    const codexPercent = rawCodex == null ? NaN : Number(rawCodex);
    if (!windows.primary && Number.isFinite(codexPercent)) {
        windows.primary = { usedPercent: clampPercent(codexPercent), windowMinutes: null, resetsAt: null };
    }
    for (const [key, raw] of [["primary", opts.rateLimits?.primary], ["secondary", opts.rateLimits?.secondary]] as const) {
        if (!raw) continue;
        const used = Number(raw.used_percent);
        if (!Number.isFinite(used)) continue;
        const reset = Number(raw.resets_at);
        windows[key] = {
            usedPercent: clampPercent(used),
            windowMinutes: Number.isFinite(Number(raw.window_minutes)) ? Number(raw.window_minutes) : null,
            resetsAt: Number.isFinite(reset) && reset > 0 ? Math.round(reset * 1000) : null,
        };
        source = "stream";
    }

    if (opts.spent) {
        // The quota just ran out: whatever the last snapshot said, the primary
        // window is full now, and we know exactly when it comes back.
        windows.primary = {
            usedPercent: 100,
            windowMinutes: windows.primary?.windowMinutes ?? null,
            resetsAt: opts.resetsAt ?? windows.primary?.resetsAt ?? null,
        };
        source = "error";
    }

    if (!windows.primary && !windows.secondary) return null;

    const key = `llm:usage:${provider}:${account}`;
    const previous = await read(ctx, key);
    const warnedAt = keepWarning(previous, windows, now);
    const worst = Math.max(windows.primary?.usedPercent ?? 0, windows.secondary?.usedPercent ?? 0);
    // One warning per window, per credential — not per request. The threshold
    // deliberately sits well before the wall: crossing it is the last moment at
    // which switching model is a choice rather than a reaction.
    const alertAt = Number(await ctx.fns.settings.getNumber({ module: "llm", scopeType: "global", key: "usageAlertPercent", fallback: 75 }));
    const shouldWarn = !opts.spent && worst >= alertAt && !warnedAt;
    const snapshot: types.llm.UsageSnapshot = {
        provider,
        account,
        windows,
        planType: opts.planType ?? previous?.planType ?? null,
        resetCredits: opts.resetCredits === undefined ? (previous?.resetCredits ?? null) : opts.resetCredits,
        updatedAt: now,
        source,
        warnedAt: shouldWarn ? now : warnedAt,
    };

    await ctx.fns.procs.db.run({
        // A late successful response must never erase a 100%-spent snapshot
        // written by parking. Keep the existing error snapshot until its reset
        // moment passes; after that a fresh success may replace it normally.
        sql: `INSERT INTO kv (key, value) VALUES (?, ?)
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
              WHERE NOT (
                (kv.value::jsonb->>'source') = 'error'
                AND COALESCE((kv.value::jsonb->'windows'->'primary'->>'resetsAt')::bigint, 0) > ?
                AND (EXCLUDED.value::jsonb->>'source') <> 'error'
              )`,
        params: [key, JSON.stringify(snapshot), now],
    });
    if (shouldWarn) {
        const resetsAt = windows.primary?.resetsAt ?? windows.secondary?.resetsAt ?? null;
        await ctx.fns.ui.notify({
            level: "warn",
            message: `${provider}${account === "default" ? "" : `/${account}`}: ${Math.round(worst)}% of quota used`,
            body: resetsAt
                ? `Resets at ${new Date(resetsAt).toLocaleString()}. Once the quota is exhausted, agents will park until then — you can switch models in advance.`
                : undefined,
        }).catch(() => undefined);
    }
    // The quota ring is a live region on this topic: one refresh signal is all
    // it needs to repaint, and it carries no payload.
    try { ctx.fns.procs.events.refresh({ topic: "llm-usage", reason: "usage recorded" }); } catch {}
    return snapshot;
}

async function read(ctx: Context, key: string): Promise<types.llm.UsageSnapshot | null> {
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = ?", params: [key] })) as any[])[0];
    if (!row) return null;
    try { return JSON.parse(String(row.value)); } catch { return null; }
}

// A threshold fires once per window: carrying the mark forward until the window
// resets is what keeps the warning meaningful instead of constant. The reset to
// compare against is the one recorded WITH the warning — the incoming snapshot
// already describes the next window and would keep the old mark alive forever.
function keepWarning(previous: types.llm.UsageSnapshot | null, _windows: types.llm.UsageSnapshot["windows"], now: number): number | null {
    const at = previous?.warnedAt ?? null;
    if (!at) return null;
    const resets = Math.max(previous?.windows?.primary?.resetsAt ?? 0, previous?.windows?.secondary?.resetsAt ?? 0);
    if (resets && resets < now) return null;
    return at;
}

function headerReader(headers: Headers | Record<string, string> | null | undefined) {
    return (name: string): string | null => {
        if (!headers) return null;
        if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
        const bag = headers as Record<string, string>;
        return bag[name] ?? bag[name.toLowerCase()] ?? null;
    };
}

function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
