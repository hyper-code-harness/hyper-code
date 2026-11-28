/**
 * Read owner-only LLM usage totals, UTC trend and ranked groups without request or response content.
 *
 * Aggregates logical calls separately from attempts so retries cannot inflate call totals. Provider/account/model filters select matching attempts and distinct calls. Counts pending calls separately; token sums include completed direct attempts only, missing usage stays null with coverage counts. Remote attempt tokens are excluded; direct fallback attempts remain included even when the call began remotely. Remote-call counts are informational, may overlap direct calls after fallback, and ignore provider/account/model filters. Requires a real owner HTTP request; disabled or unmigrated ledgers return an empty state. Uses call start time for the half-open reporting period, including its attempts; grouped call counts are not additive across retries.
 * @param opts.from Inclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to 24 hours before to.
 * @param opts.to Exclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to now. Maximum period 366 days.
 * @param opts.source Restrict calls to local use or authenticated node clients.
 * @param opts.agentId Exact local agent id; null selects calls without an agent. Omit or empty string for all.
 * @param opts.clientId Exact authenticated client id; null selects missing client. Omit or empty string for all.
 * @param opts.provider Exact terminal provider; null selects unknown. Omit or empty string for all.
 * @param opts.account Exact terminal account label; null selects unknown. Omit or empty string for all.
 * @param opts.model Exact terminal model; null selects unknown. Omit or empty string for all.
 * @param opts.groupBy Ranked dimension. Accounts are qualified by provider. @default provider
 * @param opts.limit Maximum ranked groups; totals and trend are never truncated. @default 50 @minimum 1 @maximum 100
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Inclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to 24 hours before to. */
        from?: number | string;
        /** Exclusive UTC call-start bound: epoch milliseconds, ISO date or timestamp with timezone. Defaults to now. Maximum period 366 days. */
        to?: number | string;
        /** Restrict calls to local use or authenticated node clients. */
        source?: "local" | "node";
        /** Exact authenticated client id; null selects missing client. Omit or empty string for all. */
        clientId?: string | null;
        /** Exact local agent id; null selects calls without an agent. Omit or empty string for all. */
        agentId?: string | null;
        /** Exact terminal provider; null selects unknown. Omit or empty string for all. */
        provider?: string | null;
        /** Exact terminal account label; null selects unknown. Omit or empty string for all. */
        account?: string | null;
        /** Exact terminal model; null selects unknown. Omit or empty string for all. */
        model?: string | null;
        /** Ranked dimension. Accounts are qualified by provider. @default provider */
        groupBy?: "provider" | "model" | "account" | "client" | "agent";
        /** Maximum ranked groups; totals and trend are never truncated. @default 50 @minimum 1 @maximum 100 */
        limit?: number;
    },
): Promise<types.llmUsage.AccountingReport> {
    await ctx.fns.llmUsage.adminAccess({});
    const date = (v: string | number | undefined, fallback: number): number => {
        if (v === undefined || v === "") return fallback;
        const n = typeof v === "number" || /^\d+$/.test(String(v)) ? Number(v) : /^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2}))$/.test(v) ? Date.parse(v) : NaN;
        if (!Number.isSafeInteger(n) || n < 0 || n > 253402300799999) throw new Error("Invalid UTC reporting date");
        return n;
    };
    const to = date(opts.to, Date.now()), from = date(opts.from, to - 86_400_000);
    if (from < 0 || from >= to || to - from > 366 * 86_400_000) throw new Error("Reporting period must be positive and at most 366 days");
    if (opts.source !== undefined && opts.source !== "local" && opts.source !== "node") throw new Error("Invalid accounting source");
    const groupBy = opts.groupBy ?? "provider";
    if (!["provider", "model", "account", "client", "agent"].includes(groupBy)) throw new Error("Invalid accounting group");
    const limit = Number(opts.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Group limit must be 1..100");
    const filters: types.llmUsage.AccountingReport["filters"] = { from, to, groupBy, ...(opts.source ? { source: opts.source } : {}) };
    const cp: Array<string | number | null> = [from, to];
    const cw = ["started_at >= ?", "started_at < ?"];
    if (opts.source) { cw.push("source = ?"); cp.push(opts.source); }
    const ap: Array<string | number | null> = [];
    const aw = ["a.remote = false"];
    let dimensionFilter = false;
    for (const key of ["clientId", "agentId", "provider", "account", "model"] as const) {
        const value = opts[key];
        if (value === undefined || value === "") continue;
        if (value !== null && (typeof value !== "string" || value.length > 160 || /[\x00-\x1f]/.test(value))) throw new Error("Invalid accounting filter");
        filters[key] = value;
        const callLevel = key === "clientId" || key === "agentId";
        const column = key === "clientId" ? "client_id" : key === "agentId" ? "agent_id" : "a." + key;
        const where = callLevel ? cw : aw;
        const params = callLevel ? cp : ap;
        where.push(column + (value === null ? " IS NULL" : " = ?"));
        if (value !== null) params.push(value);
        if (!callLevel) dimensionFilter = true;
    }
    const empty: types.llmUsage.AccountingReport = { enabled: false, available: false, reason: "disabled", filters, totals: { calls: 0, remoteCalls: 0, success: 0, errors: 0, cancelled: 0, pending: 0, attempts: 0, completedAttempts: 0, extraAttempts: 0, inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, known: 0, partial: 0, unknown: 0 }, trend: [], groups: [] };
    if (await ctx.fns.settings.get({ module: "llmUsage", scopeType: "global", key: "enabled" }) !== true) return empty;
    const schema = await ctx.fns.procs.db.select({ sql: "SELECT to_regclass('llm_usage_calls') IS NOT NULL AND to_regclass('llm_usage_attempts') IS NOT NULL AS ready", params: [] });
    if (!schema[0]?.ready) return { ...empty, enabled: true, reason: "not-migrated" };
    const bucket = to - from <= 2 * 86_400_000 ? 3_600_000 : 86_400_000;
    const tokens = (alias: string) => [ ["input_tokens", "inputTokens"], ["output_tokens", "outputTokens"], ["cache_read_tokens", "cacheReadTokens"], ["cache_write_tokens", "cacheWriteTokens"] ].map(([column, field]) => "'" + field + "', sum(" + alias + "." + column + ") FILTER (WHERE " + alias + ".status <> 'pending')").join(", ");
    const groupKey = groupBy === "client" ? "c.client_id" : groupBy === "agent" ? "c.agent_id" : groupBy === "account" ? "a.provider || '/' || a.account" : "a." + groupBy;
    const groupLabel = groupBy === "client" ? "coalesce(max(c.client_name), c.client_id, 'local / unknown')" : "coalesce(" + groupKey + ", 'unknown')";
    const rows = await ctx.fns.procs.db.select({ sql: `
    WITH base AS MATERIALIZED (SELECT * FROM llm_usage_calls WHERE ${cw.join(" AND ")}),
    ma AS MATERIALIZED (SELECT a.* FROM llm_usage_attempts a JOIN base c ON c.id = a.call_id WHERE ${aw.join(" AND ")}),
    calls AS MATERIALIZED (SELECT * FROM base c WHERE (c.remote = false OR EXISTS (SELECT 1 FROM llm_usage_attempts direct WHERE direct.call_id = c.id AND direct.remote = false)) ${dimensionFilter ? "AND EXISTS (SELECT 1 FROM ma WHERE ma.call_id = c.id)" : ""}),
    ct AS (SELECT json_build_object('remoteCalls', (SELECT count(*) FROM base WHERE remote = true), 'calls', count(*), 'success', count(*) FILTER(WHERE status='success'), 'errors', count(*) FILTER(WHERE status='error'), 'cancelled', count(*) FILTER(WHERE status='cancelled'), 'pending', count(*) FILTER(WHERE status='pending'))::jsonb AS value FROM calls),
    at AS (SELECT json_build_object('attempts', count(*), 'completedAttempts', count(*) FILTER(WHERE a.status <> 'pending'), 'extraAttempts', count(*) - count(DISTINCT call_id), ${tokens("a")}, 'known', count(*) FILTER(WHERE a.status <> 'pending' AND usage_state='known'), 'partial', count(*) FILTER(WHERE a.status <> 'pending' AND usage_state='partial'), 'unknown', count(*) FILTER(WHERE a.status <> 'pending' AND usage_state='unknown'))::jsonb AS value FROM ma a),
    buckets AS (SELECT g AS bucket FROM generate_series((?::bigint / ?::bigint) * ?::bigint, ((?::bigint - 1) / ?::bigint) * ?::bigint, ?::bigint) g),
    trend AS (SELECT b.bucket, json_build_object('at', b.bucket, 'calls', count(DISTINCT c.id), 'attempts', count(a.id), ${tokens("a")}) AS value FROM buckets b LEFT JOIN calls c ON (c.started_at / ${bucket}) * ${bucket} = b.bucket LEFT JOIN ma a ON a.call_id = c.id GROUP BY b.bucket),
    groups AS (SELECT json_build_object('key', coalesce(${groupKey}, ''), 'label', ${groupLabel}, 'calls', count(DISTINCT c.id), 'attempts', count(a.id), ${tokens("a")}) AS value, count(a.id) AS n FROM calls c ${groupBy === "client" || groupBy === "agent" ? "LEFT JOIN" : "JOIN"} ma a ON a.call_id = c.id GROUP BY ${groupKey} ORDER BY n DESC, ${groupKey} NULLS LAST LIMIT ?)
    SELECT (SELECT value FROM ct) || (SELECT value FROM at) AS totals,
           (SELECT coalesce(json_agg(value ORDER BY bucket), '[]'::json) FROM trend) AS trend,
           (SELECT coalesce(json_agg(value), '[]'::json) FROM groups) AS groups`, params: [...cp, ...ap, from, bucket, bucket, to, bucket, bucket, bucket, limit] });
    const row = rows[0];
    return { ...empty, enabled: true, available: true, reason: null, totals: row.totals, trend: row.trend, groups: row.groups };
}
