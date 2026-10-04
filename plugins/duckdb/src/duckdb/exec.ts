// The deliberate counterpart to duckdb.query: everything that changes the
// session — CREATE VIEW/TABLE, ATTACH, INSTALL/LOAD, COPY to a file. It exists
// because the in-process engine keeps state between calls, which only pays off
// if something is allowed to create that state.

/**
 * Runs a DuckDB statement that changes state and persists it for later queries.
 *
 * Use for `CREATE TABLE`/`CREATE VIEW` over a file so later queries can name it,
 * for `INSTALL`/`LOAD` of an extension, for `ATTACH` of another database, or for
 * `COPY ... TO 'out.parquet'` to write a result out. The in-process engine keeps
 * the catalogue alive for the whole runtime, so a view made here is visible to
 * every later `duckdb.query`. Read-only questions belong in `duckdb.query`,
 * which refuses these statements on purpose.
 * @param opts.sql DuckDB statement to execute.
 * @param opts.params Values bound to `?` placeholders.
 * @param opts.db DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database.
 * @param opts.timeout Seconds before the statement is interrupted. @default 60 @minimum 1 @maximum 300
 * @returns Any rows the statement returned and the table names now in the catalogue.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** DuckDB statement to execute. */
    sql: string;
    /** Values bound to `?` placeholders. */
    params?: unknown[];
    /** DuckDB database file; relative paths resolve in the workspace. Omit for the shared in-memory database. */
    db?: string;
    /** Seconds before the statement is interrupted. @default 60 @minimum 1 @maximum 300 */
    timeout?: number;
}): Promise<{ rows: any[]; tables: string[] }> {
    const sql = String(opts.sql ?? "").trim();
    if (!sql) throw new Error("duckdb.exec: sql is required");
    const { instance, reason } = await ctx.fns.duckdb.conn({ db: opts.db });
    if (!instance) throw new Error(`duckdb.exec: needs the in-process engine, which is unavailable — ${reason}`);
    const rows = await ctx.fns.duckdb.run({ sql, params: opts.params, db: opts.db, timeout: opts.timeout ?? 60 });
    const tables = await ctx.fns.duckdb.run({ sql: "SELECT table_name FROM information_schema.tables ORDER BY table_name", db: opts.db });
    return { rows, tables: tables.map((row: any) => String(row.table_name)) };
}
