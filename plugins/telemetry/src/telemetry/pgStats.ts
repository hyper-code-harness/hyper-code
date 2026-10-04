// The classic server-side view: pg_stat_statements. Span timings measure what
// the application waited for; this measures what the server actually did —
// planning, execution, rows, shared-buffer hits. The two disagree exactly where
// the interesting problems are (connection pool waits, N+1, cache misses).
/**
 * Report the slowest Postgres statements from pg_stat_statements.
 *
 * Returns `{ available: false, reason }` instead of throwing when the extension
 * is not installed or not preloaded, so a dashboard can explain the gap rather
 * than break. Statements belonging to this query itself and to the extension's
 * own catalogue are excluded.
 *
 * @param opts.limit Rows to return. @default 10 @minimum 1 @maximum 100
 * @param opts.orderBy Ranking measure. @default "total"
 * @param opts.minCalls Ignore statements called fewer times than this. @default 1 @minimum 1
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Rows to return. @default 10 @minimum 1 @maximum 100 */
    limit?: number;
    /** Ranking measure: total wall time, mean time, or call count. @default "total" */
    orderBy?: "total" | "mean" | "calls";
    /** Ignore statements called fewer times than this. @default 1 @minimum 1 */
    minCalls?: number;
}): Promise<{
    available: boolean;
    reason: string | null;
    since: string | null;
    rows: Array<{
        query: string;
        calls: number;
        totalSec: number;
        meanMs: number;
        maxMs: number;
        rows: number;
        rowsPerCall: number;
        hitPercent: number | null;
        sharedRead: number;
    }>;
}> {
    const limit = Math.max(1, Math.min(Number(opts?.limit ?? 10), 100));
    const minCalls = Math.max(1, Number(opts?.minCalls ?? 1));
    const order = opts?.orderBy === "mean" ? "mean_exec_time" : opts?.orderBy === "calls" ? "calls" : "total_exec_time";
    const empty = { available: false, reason: null as string | null, since: null as string | null, rows: [] };

    const installed = await ctx.fns.procs.db.select({
        sql: "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'",
    }).catch(() => []) as any[];
    if (!installed.length) {
        return { ...empty, reason: "pg_stat_statements is not installed — CREATE EXTENSION pg_stat_statements" };
    }

    // Reading the view is the only honest probe: the extension can be installed
    // while the library is absent from shared_preload_libraries, and then every
    // select against it fails.
    let rows: any[];
    try {
        rows = await ctx.fns.procs.db.select({
            sql: `SELECT query,
                         calls,
                         round((total_exec_time / 1000)::numeric, 1) AS total_sec,
                         round(mean_exec_time::numeric, 2) AS mean_ms,
                         round(max_exec_time::numeric, 1) AS max_ms,
                         rows,
                         round((rows::numeric / NULLIF(calls, 0)), 1) AS rows_per_call,
                         CASE WHEN shared_blks_hit + shared_blks_read > 0
                              THEN round(100.0 * shared_blks_hit / (shared_blks_hit + shared_blks_read), 1)
                              ELSE NULL END AS hit_percent,
                         shared_blks_read
                  FROM pg_stat_statements
                  WHERE calls >= ?
                    AND query NOT LIKE '%pg_stat_statements%'
                    AND query NOT LIKE '%pg_catalog.pg_%'
                  ORDER BY ${order} DESC
                  LIMIT ?`,
            params: [minCalls, limit],
        }) as any[];
    } catch (error: any) {
        const message = String(error?.message ?? error);
        const preload = message.includes("shared_preload_libraries");
        return {
            ...empty,
            reason: preload
                ? "pg_stat_statements is installed but not preloaded — add it to shared_preload_libraries and restart Postgres"
                : message.slice(0, 300),
        };
    }

    const reset = await ctx.fns.procs.db.select({
        sql: "SELECT to_char(stats_reset, 'YYYY-MM-DD HH24:MI') AS since FROM pg_stat_statements_info",
    }).catch(() => []) as any[];

    return {
        available: true,
        reason: null,
        since: reset[0]?.since ?? null,
        rows: rows.map(row => ({
            query: String(row.query ?? "").replace(/\s+/g, " ").trim(),
            calls: Number(row.calls ?? 0),
            totalSec: Number(row.total_sec ?? 0),
            meanMs: Number(row.mean_ms ?? 0),
            maxMs: Number(row.max_ms ?? 0),
            rows: Number(row.rows ?? 0),
            rowsPerCall: Number(row.rows_per_call ?? 0),
            hitPercent: row.hit_percent == null ? null : Number(row.hit_percent),
            sharedRead: Number(row.shared_blks_read ?? 0),
        })),
    };
}
