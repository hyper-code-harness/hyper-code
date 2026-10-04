/**
 * Runs read-only DuckDB SQL and returns bounded, JSON-safe rows.
 *
 * The default way to ask DuckDB a question: analytics over local NDJSON, JSON,
 * CSV and Parquet files, over an ATTACHed Postgres database, or over views and
 * tables made earlier with `duckdb.exec`. Statements that write, install
 * extensions or attach databases are rejected here — use `duckdb.exec` when
 * that is the intent. Rows are capped at `maxRows` and the result says whether
 * anything was cut.
 * @param opts.sql Read-only DuckDB SQL statement.
 * @param opts.params Values bound to `?` placeholders, which keeps user input out of the SQL text.
 * @param opts.db DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @param opts.maxRows Maximum returned rows. @default 1000 @minimum 1 @maximum 100000
 * @param opts.timeout Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300
 * @returns The rows, the total row count the query produced, and whether the rows were truncated.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Read-only DuckDB SQL statement. */
        sql: string;
        /** Values bound to `?` placeholders, which keeps user input out of the SQL text. */
        params?: unknown[];
        /** DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database. */
        db?: string;
        /** Maximum returned rows. @default 1000 @minimum 1 @maximum 100000 */
        maxRows?: number;
        /** Seconds before the query is interrupted. @default 30 @minimum 1 @maximum 300 */
        timeout?: number;
    },
): Promise<{ rows: any[]; rowCount: number; truncated: boolean }> {
    const sql = String(opts.sql ?? "").trim();
    if (!sql) throw new Error("duckdb.query: sql is required");
    // A semicolon inside a string is legal, so this is deliberately a keyword
    // boundary check rather than an attempted SQL parser. Anything that changes
    // state is a deliberate act and belongs in duckdb.exec.
    if (/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|COPY|EXPORT|IMPORT|INSTALL|LOAD|ATTACH|DETACH|CALL|PRAGMA)\b/i.test(stripStrings(sql))) {
        throw new Error("duckdb.query: only read-only SQL is allowed; use duckdb.exec for statements that change state");
    }
    const rows = await ctx.fns.duckdb.run({ sql, params: opts.params, db: opts.db, timeout: opts.timeout });
    const maxRows = Math.max(1, Math.min(Number(opts.maxRows ?? 1000), 100_000));
    return { rows: rows.slice(0, maxRows), rowCount: rows.length, truncated: rows.length > maxRows };
}

function stripStrings(sql: string): string {
    return sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
}
