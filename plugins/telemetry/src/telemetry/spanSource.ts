// One SQL expression covering both tiers. Columns are declared rather than
// sniffed: an NDJSON page whose first rows happen to carry no `error.type`
// attribute must still union with parquet written when they did.
/**
 * Build the DuckDB table expression that unions hot NDJSON pages with cold parquet.
 *
 * Returns a `WITH`-free scalar expression usable directly after `FROM`, plus
 * which tiers actually contributed, so a caller can explain an empty result.
 *
 * @param opts.tier Restrict the expression to one storage tier. @default "all"
 * @param opts.sinceDays Only read cold partitions newer than this many days; 0 reads everything. @minimum 0
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Restrict the expression to one storage tier. @default "all" */
    tier?: "all" | "hot" | "cold";
    /** Only read cold partitions newer than this many days; 0 reads everything. @minimum 0 */
    sinceDays?: number;
}): Promise<{ sql: string; hot: boolean; cold: boolean }> {
    const { glob } = await import("node:fs/promises");
    const layout = await ctx.fns.telemetry.paths({});
    const tier = opts?.tier ?? "all";
    const columns = "{Timestamp:'TIMESTAMP',TraceId:'VARCHAR',SpanId:'VARCHAR',ParentSpanId:'VARCHAR',Name:'VARCHAR',DurationMs:'DOUBLE',Status:'VARCHAR',Attributes:'JSON'}";
    const fields = "Timestamp, TraceId, SpanId, ParentSpanId, Name, DurationMs, Status, Attributes";

    const any = async (pattern: string) => {
        for await (const _ of glob(pattern)) return true;
        return false;
    };
    // DuckDB fails the whole query when any listed glob matches nothing, so a
    // tier is named only after its files are confirmed to exist.
    const openGlob = `${layout.open}/*.ndjson`;
    const pagesGlob = `${layout.pages}/*.ndjson`;
    const hotGlobs = tier === "cold" ? [] : (await Promise.all([openGlob, pagesGlob].map(async g => (await any(g)) ? g : null))).filter((g): g is string => g !== null);
    const cold = tier !== "hot" && await any(`${layout.cold}/**/*.parquet`);
    const hot = hotGlobs.length > 0;

    const parts: string[] = [];
    if (cold) {
        const since = Math.max(0, Number(opts?.sinceDays ?? 0));
        const filter = since ? ` WHERE Timestamp >= now() - INTERVAL ${Math.floor(since)} DAY` : "";
        parts.push(`SELECT ${fields} FROM read_parquet('${layout.cold}/**/*.parquet', hive_partitioning=true, union_by_name=true)${filter}`);
    }
    if (hot) {
        parts.push(`SELECT ${fields} FROM read_ndjson([${hotGlobs.map(g => `'${g}'`).join(",")}], ignore_errors=true, columns=${columns})`);
    }
    // No files at all: a typed empty relation keeps every caller's SQL valid.
    const sql = parts.length
        ? `(${parts.join(" UNION ALL ")})`
        : `(SELECT NULL::TIMESTAMP AS Timestamp, NULL::VARCHAR AS TraceId, NULL::VARCHAR AS SpanId, NULL::VARCHAR AS ParentSpanId, NULL::VARCHAR AS Name, NULL::DOUBLE AS DurationMs, NULL::VARCHAR AS Status, NULL::JSON AS Attributes WHERE false)`;
    return { sql, hot, cold };
}
