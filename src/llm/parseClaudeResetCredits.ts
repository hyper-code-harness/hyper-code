/**
 * Normalize read-only Claude reset grants without confusing unavailable counts with zero
 *
 * Use on cedar_ember from the Claude OAuth usage read endpoint. Produces display-only reset availability and expiry metadata, counts remaining uses rather than grant rows, excludes expired or future grants, and preserves unsupported surface as an unknown count. Never requests or redeems a grant.
 * @param opts.status Untrusted cedar_ember reset-status object; null or missing means availability was not exposed.
 * @param opts.now Current epoch milliseconds for checking grant dates and timestamping availability; defaults to the current clock.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Untrusted cedar_ember reset-status object; null or missing means availability was not exposed. */
        status: unknown;
        /** Current epoch milliseconds for checking grant dates and timestamping availability; defaults to the current clock. */
        now?: number;
    },
): Promise<NonNullable<types.llm.UsageSnapshot["resetCredits"]>> {
    const now = opts.now ?? Date.now();
    const unknownCount = (unavailableReason: "surface" | "unavailable" | "invalid-response"): NonNullable<types.llm.UsageSnapshot["resetCredits"]> => ({ availableCount: null, checkedAt: now, unavailableReason, credits: [] });
    if (opts.status == null) return unknownCount("unavailable");
    if (typeof opts.status !== "object" || Array.isArray(opts.status)) return unknownCount("invalid-response");
    const status = opts.status as Record<string, unknown>;
    if (status.ineligible_reason === "surface") return unknownCount("surface");
    if (status.eligible !== true) return unknownCount("unavailable");
    if (!Array.isArray(status.grants) || status.grants.length > 100) return unknownCount("invalid-response");
    const credits: NonNullable<types.llm.UsageSnapshot["resetCredits"]>["credits"] = [];
    const seen = new Set<string>();
    let availableCount = 0;
    for (const item of status.grants) {
        if (!item || typeof item !== "object" || Array.isArray(item)) return unknownCount("invalid-response");
        const g = item as Record<string, unknown>;
        if (typeof g.id !== "string" || !g.id || g.id.length > 256 || seen.has(g.id)
            || typeof g.resets_left !== "number" || !Number.isSafeInteger(g.resets_left) || g.resets_left < 0
            || typeof g.resets_total !== "number" || !Number.isSafeInteger(g.resets_total) || g.resets_total < g.resets_left
            || g.resets_total > 10_000 || typeof g.ends_at !== "string" || !Number.isFinite(Date.parse(g.ends_at))
            || typeof g.starts_at !== "string" || !Number.isFinite(Date.parse(g.starts_at))) return unknownCount("invalid-response");
        seen.add(g.id);
        const start = Date.parse(g.starts_at), end = Date.parse(g.ends_at);
        if (end <= start) return unknownCount("invalid-response");
        if (end <= now || start > now || g.resets_left === 0) continue;
        const usableNow = g.usable_now === true && g.claimable !== false && g.paused !== true;
        availableCount += g.resets_left;
        credits.push({ id: g.id, resetType: typeof g.type === "string" ? g.type.slice(0, 80) : "claude_limit_reset", status: usableNow ? "available" : "restricted", remainingCount: g.resets_left, usableNow,
            grantedAt: start, expiresAt: end, title: typeof g.label === "string" ? g.label.slice(0, 500) : "Claude limit reset",
            description: Array.isArray(g.clears) ? g.clears.filter((x): x is string => typeof x === "string").slice(0, 12).map(x => x.slice(0, 80)).join(", ") : null });
    }
    credits.sort((a, b) => Number(a.expiresAt) - Number(b.expiresAt));
    return { availableCount, checkedAt: now, credits };
}
