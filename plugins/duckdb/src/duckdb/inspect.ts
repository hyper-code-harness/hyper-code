/**
 * Describes columns, row count and sample rows of a local analytics file.
 *
 * The first call to make against an unfamiliar file: it names the columns and
 * their DuckDB types, counts the rows, and shows a few so a query can be
 * written against something real instead of a guess. Supports NDJSON, JSON,
 * CSV, TSV and Parquet.
 * @param opts.path Local analytics file to inspect.
 * @param opts.sample Number of sample rows. @default 5 @minimum 1 @maximum 50
 * @param opts.timeout Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300
 * @returns The resolved path, the detected format, the columns with types, the total row count, and sample rows.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Local analytics file to inspect. */
        path: string;
        /** Number of sample rows. @default 5 @minimum 1 @maximum 50 */
        sample?: number;
        /** Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300 */
        timeout?: number;
    },
): Promise<{ path: string; format: string; columns: Array<{ name: string; type: string; nullable: string }>; rowCount: number; sample: any[] }> {
    const source = ctx.fns.duckdb.source({ path: opts.path });
    const sample = Math.max(1, Math.min(Number(opts.sample ?? 5), 50));
    const schema = await ctx.fns.duckdb.run({ sql: `DESCRIBE SELECT * FROM ${source.table}`, timeout: opts.timeout });
    const counted = await ctx.fns.duckdb.run({ sql: `SELECT count(*) AS n FROM ${source.table}`, timeout: opts.timeout });
    const rows = await ctx.fns.duckdb.run({ sql: `SELECT * FROM ${source.table} LIMIT ${sample}`, timeout: opts.timeout });
    return {
        path: source.path,
        format: source.format,
        columns: schema.map((x: any) => ({ name: x.column_name, type: x.column_type, nullable: x.null })),
        rowCount: Number(counted[0]?.n ?? 0),
        sample: rows,
    };
}
