/**
 * Builds and runs a query over a local NDJSON, JSON, CSV, TSV or Parquet file.
 *
 * The no-SQL-assembly path for routine log and table analysis: name the file
 * and the parts — a filter, a projection, grouping, ordering — and get the rows
 * plus the SQL that produced them, which is the starting point for a hand-
 * written `duckdb.query` when the question grows. SQL fragments are passed to
 * DuckDB as written, so they may use any DuckDB expression.
 * @param opts.path Source file: NDJSON, JSONL, JSON, CSV, TSV or Parquet.
 * @param opts.select SQL SELECT expression list. @default *
 * @param opts.where SQL predicate without the `WHERE` keyword.
 * @param opts.groupBy SQL grouping expressions without the `GROUP BY` keywords.
 * @param opts.orderBy SQL ordering expressions without the `ORDER BY` keywords.
 * @param opts.limit SQL LIMIT. @default 100 @minimum 1 @maximum 100000
 * @param opts.timeout Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300
 * @returns The generated SQL, the rows, the row count and whether they were truncated.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Source file: NDJSON, JSONL, JSON, CSV, TSV or Parquet. */
        path: string;
        /** SQL SELECT expression list. @default * */
        select?: string;
        /** SQL predicate without the `WHERE` keyword. */
        where?: string;
        /** SQL grouping expressions without the `GROUP BY` keywords. */
        groupBy?: string;
        /** SQL ordering expressions without the `ORDER BY` keywords. */
        orderBy?: string;
        /** SQL LIMIT. @default 100 @minimum 1 @maximum 100000 */
        limit?: number;
        /** Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300 */
        timeout?: number;
    },
): Promise<{ sql: string; rows: any[]; rowCount: number; truncated: boolean }> {
    const source = ctx.fns.duckdb.source({ path: opts.path });
    const limit = Math.max(1, Math.min(Number(opts.limit ?? 100), 100_000));
    const sql = [
        `SELECT ${String(opts.select || "*")} FROM ${source.table}`,
        opts.where ? `WHERE ${opts.where}` : "",
        opts.groupBy ? `GROUP BY ${opts.groupBy}` : "",
        opts.orderBy ? `ORDER BY ${opts.orderBy}` : "",
        `LIMIT ${limit}`,
    ].filter(Boolean).join("\n");
    return { sql, ...(await ctx.fns.duckdb.query({ sql, maxRows: limit, timeout: opts.timeout })) };
}
