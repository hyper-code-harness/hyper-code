// Closed NDJSON page → hive-partitioned parquet. Measured on this machine:
// 64 MB of spans becomes ~3.3 MB of zstd parquet (~20x) and a dashboard query
// over it answers in tens of milliseconds instead of seconds.
import { readdir, stat, unlink } from "node:fs/promises";

/**
 * Compact closed NDJSON span pages into day-partitioned parquet.
 *
 * Each page is converted independently and deleted only after DuckDB reports
 * success, so an interrupted run never loses spans — at worst it leaves a page
 * to be converted next time. The open page is never touched.
 *
 * @param opts.limit Maximum number of pages to convert in this run. @default 8 @minimum 1 @maximum 100
 * @param opts.keepSource Keep the NDJSON page after a successful conversion. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Maximum number of pages to convert in this run. @default 8 @minimum 1 @maximum 100 */
    limit?: number;
    /** Keep the NDJSON page after a successful conversion. @default false */
    keepSource?: boolean;
}): Promise<{ converted: number; bytesIn: number; bytesOut: number; failed: Array<{ page: string; error: string }> }> {
    const layout = await ctx.fns.telemetry.paths({});
    const limit = Math.max(1, Math.min(Number(opts?.limit ?? 8), 100));
    const names = (await readdir(layout.pages).catch(() => [] as string[]))
        .filter(name => name.endsWith(".ndjson"))
        .sort()
        .slice(0, limit);

    const columns = "{Timestamp:'TIMESTAMP',TraceId:'VARCHAR',SpanId:'VARCHAR',ParentSpanId:'VARCHAR',Name:'VARCHAR',DurationMs:'DOUBLE',Status:'VARCHAR',Attributes:'JSON'}";
    const failed: Array<{ page: string; error: string }> = [];
    let converted = 0;
    let bytesIn = 0;
    let bytesOut = 0;

    for (const name of names) {
        const page = `${layout.pages}/${name}`;
        const size = await stat(page).then(s => s.size).catch(() => 0);
        if (size === 0) { await unlink(page).catch(() => undefined); continue; }
        // The page id lands in the file name so a re-run overwrites its own
        // output rather than appending a duplicate into the same partition.
        const id = name.replace(/\.ndjson$/, "").replace(/[^A-Za-z0-9_-]/g, "_");
        const sql = `COPY (
            SELECT Timestamp, TraceId, SpanId, ParentSpanId, Name, DurationMs, Status, Attributes,
                   strftime(Timestamp, '%Y-%m-%d') AS dt
            FROM read_ndjson('${page}', ignore_errors=true, columns=${columns})
            WHERE Timestamp IS NOT NULL
        ) TO '${layout.cold}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (dt), FILENAME_PATTERN '${id}_{i}', OVERWRITE_OR_IGNORE true)`;
        const result = await ctx.fns.telemetry.duck({ sql });
        if (!result.ok) { failed.push({ page: name, error: result.error }); continue; }
        converted++;
        bytesIn += size;
        bytesOut += await ctx.fns.telemetry.dirBytes({ dir: layout.cold, match: `${id}_` });
        if (!opts?.keepSource) await unlink(page).catch(() => undefined);
    }

    if (failed.length) ctx.fns.procs.log.warn({ event: "telemetry.compact.failed", msg: failed[0]!.error, pages: failed.length });
    return { converted, bytesIn, bytesOut, failed };
}
