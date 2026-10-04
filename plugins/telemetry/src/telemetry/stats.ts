// The dashboard's numbers, in one DuckDB pass per section. Attributes are read
// as JSON paths rather than struct fields, because the set of attributes grows
// over time and old parquet must keep answering.
/**
 * Compute performance statistics over stored spans for a time window.
 *
 * Returns span-kind totals, the slowest HTTP routes, the database queries that
 * cost the most wall time, recent slow or failed spans, and traffic over time.
 * Every section is bounded, so the result is safe to render directly.
 *
 * @param opts.hours Window size in hours ending now. @default 24 @minimum 1 @maximum 8760
 * @param opts.limit Rows per ranked section. @default 10 @minimum 1 @maximum 100
 * @param opts.slowMs Duration in milliseconds above which a span is listed as slow. @default 500 @minimum 1
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Window size in hours ending now. @default 24 @minimum 1 @maximum 8760 */
    hours?: number;
    /** Rows per ranked section. @default 10 @minimum 1 @maximum 100 */
    limit?: number;
    /** Duration in milliseconds above which a span is listed as slow. @default 500 @minimum 1 */
    slowMs?: number;
}): Promise<{
    ok: boolean;
    error: string | null;
    hours: number;
    tiers: { hot: boolean; cold: boolean };
    totals: { spans: number; errors: number; traces: number; from: string | null; to: string | null };
    kinds: Array<{ name: string; count: number; errors: number; p50: number; p95: number; max: number; totalSec: number }>;
    routes: Array<{ route: string; count: number; p50: number; p95: number; max: number; totalSec: number }>;
    queries: Array<{ query: string; count: number; p95: number; totalSec: number }>;
    slow: Array<{ ts: string; name: string; ms: number; status: string; detail: string; traceId: string }>;
    traffic: Array<{ bucket: string; count: number; errors: number; p95: number }>;
}> {
    const hours = Math.max(1, Math.min(Number(opts?.hours ?? 24), 8760));
    const limit = Math.max(1, Math.min(Number(opts?.limit ?? 10), 100));
    const slowMs = Math.max(1, Number(opts?.slowMs ?? 500));
    const source = await ctx.fns.telemetry.spanSource({ sinceDays: Math.ceil(hours / 24) + 1 });
    const bucketMinutes = hours <= 6 ? 5 : hours <= 48 ? 30 : 180;

    // One process, one scan: each section is a CTE over the same window.
    const sql = `
WITH win AS (
  SELECT Timestamp, TraceId, Name, DurationMs, Status, Attributes,
         Attributes->>'$."http.route"' AS route,
         Attributes->>'$."db.query.summary"' AS query,
         Attributes->>'$."error.message"' AS err,
         Attributes->>'$."tool.name"' AS tool,
         Attributes->>'$."llm.model"' AS model
  FROM ${source.sql}
  WHERE Timestamp >= now() - INTERVAL ${hours} HOUR
),
totals AS (
  SELECT 'totals' AS section, count(*) AS spans, count(*) FILTER (WHERE Status = 'error') AS "errors",
         count(DISTINCT TraceId) AS traces,
         strftime(min(Timestamp), '%Y-%m-%d %H:%M') AS from_ts,
         strftime(max(Timestamp), '%Y-%m-%d %H:%M') AS to_ts
  FROM win
),
kinds AS (
  SELECT Name AS "name", count(*) AS "count", count(*) FILTER (WHERE Status = 'error') AS "errors",
         round(quantile_cont(DurationMs, 0.5), 1) AS p50,
         round(quantile_cont(DurationMs, 0.95), 1) AS p95,
         round(max(DurationMs), 1) AS "max",
         round(sum(DurationMs) / 1000, 1) AS total_sec
  FROM win GROUP BY 1 ORDER BY count DESC
),
routes AS (
  SELECT route, count(*) AS "count",
         round(quantile_cont(DurationMs, 0.5), 1) AS p50,
         round(quantile_cont(DurationMs, 0.95), 1) AS p95,
         round(max(DurationMs), 1) AS "max",
         round(sum(DurationMs) / 1000, 1) AS total_sec
  FROM win WHERE route IS NOT NULL GROUP BY 1 ORDER BY total_sec DESC LIMIT ${limit}
),
queries AS (
  SELECT query, count(*) AS "count",
         round(quantile_cont(DurationMs, 0.95), 1) AS p95,
         round(sum(DurationMs) / 1000, 1) AS total_sec
  FROM win WHERE query IS NOT NULL GROUP BY 1 ORDER BY total_sec DESC LIMIT ${limit}
),
slow AS (
  SELECT strftime(Timestamp, '%m-%d %H:%M:%S') AS ts, Name AS name,
         round(DurationMs, 1) AS ms, Status AS status, TraceId AS trace_id,
         coalesce(err, route, tool, model, query, '') AS detail
  FROM win WHERE Status = 'error' OR DurationMs >= ${slowMs}
  ORDER BY Timestamp DESC LIMIT ${limit}
),
traffic AS (
  SELECT strftime(time_bucket(INTERVAL ${bucketMinutes} MINUTE, Timestamp), '%m-%d %H:%M') AS bucket,
         count(*) AS "count", count(*) FILTER (WHERE Status = 'error') AS "errors",
         round(quantile_cont(DurationMs, 0.95), 1) AS p95
  FROM win GROUP BY 1 ORDER BY 1
)
SELECT 'totals' AS section, to_json(totals) AS row FROM totals
UNION ALL SELECT 'kinds', to_json(kinds) FROM kinds
UNION ALL SELECT 'routes', to_json(routes) FROM routes
UNION ALL SELECT 'queries', to_json(queries) FROM queries
UNION ALL SELECT 'slow', to_json(slow) FROM slow
UNION ALL SELECT 'traffic', to_json(traffic) FROM traffic`;

    const result = await ctx.fns.telemetry.duck({ sql });
    const empty = {
        ok: result.ok, error: result.ok ? null : result.error, hours,
        tiers: { hot: source.hot, cold: source.cold },
        totals: { spans: 0, errors: 0, traces: 0, from: null as string | null, to: null as string | null },
        kinds: [] as any[], routes: [] as any[], queries: [] as any[], slow: [] as any[], traffic: [] as any[],
    };
    if (!result.ok) return empty;

    const pick = (section: string) => result.rows
        .filter((row: any) => row.section === section)
        .map((row: any) => (typeof row.row === "string" ? JSON.parse(row.row) : row.row));
    const totals = pick("totals")[0] ?? {};

    return {
        ...empty,
        totals: {
            spans: Number(totals.spans ?? 0), errors: Number(totals.errors ?? 0), traces: Number(totals.traces ?? 0),
            from: totals.from_ts ?? null, to: totals.to_ts ?? null,
        },
        kinds: pick("kinds").map((r: any) => ({ name: r.name ?? "?", count: Number(r.count), errors: Number(r.errors), p50: Number(r.p50), p95: Number(r.p95), max: Number(r.max), totalSec: Number(r.total_sec) })),
        routes: pick("routes").map((r: any) => ({ route: r.route, count: Number(r.count), p50: Number(r.p50), p95: Number(r.p95), max: Number(r.max), totalSec: Number(r.total_sec) })),
        queries: pick("queries").map((r: any) => ({ query: r.query, count: Number(r.count), p95: Number(r.p95), totalSec: Number(r.total_sec) })),
        slow: pick("slow").map((r: any) => ({ ts: r.ts, name: r.name, ms: Number(r.ms), status: r.status, detail: String(r.detail ?? ""), traceId: String(r.trace_id ?? "") })),
        traffic: pick("traffic").map((r: any) => ({ bucket: r.bucket, count: Number(r.count), errors: Number(r.errors), p95: Number(r.p95) })),
    };
}
