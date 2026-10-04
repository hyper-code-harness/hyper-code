// DuckDB's postgres extension can read a live Postgres directly, so the whole
// project database becomes queryable with window functions, file joins and
// Parquet export without copying anything out. Attaching is idempotent: the
// in-process instance keeps the attachment, so later calls are a no-op and
// every duckdb.query sees `pg.public.*`.

/**
 * Attaches a Postgres database to DuckDB so SQL can read its tables directly.
 *
 * Defaults to this project's own Postgres, read-only, under the alias `pg` —
 * after one call `duckdb.query` can run `SELECT ... FROM pg.public.agents`,
 * join a Postgres table against a local Parquet or NDJSON file, and use DuckDB
 * window and aggregate functions on live data. Attaching twice is harmless.
 * Needs the in-process engine; the CLI fallback cannot keep an attachment.
 * @param opts.url Postgres connection URL. Defaults to this project's database.
 * @param opts.alias Catalogue name the database is attached under. @default pg
 * @param opts.writable Attach read-write instead of read-only. @default false
 * @returns The alias, whether this call created the attachment, and the tables it exposes.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Postgres connection URL. Defaults to this project's database. */
    url?: string;
    /** Catalogue name the database is attached under. @default pg */
    alias?: string;
    /** Attach read-write instead of read-only. @default false */
    writable?: boolean;
}): Promise<{ alias: string; attached: boolean; tables: string[] }> {
    const alias = String(opts?.alias ?? "pg").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`duckdb.pg: alias must be a plain identifier, got ${alias}`);
    const { instance, reason } = await ctx.fns.duckdb.conn({});
    if (!instance) throw new Error(`duckdb.pg: needs the in-process engine, which is unavailable — ${reason}`);

    const already = await ctx.fns.duckdb.run({ sql: "SELECT database_name FROM duckdb_databases() WHERE database_name = ?", params: [alias] });
    let attached = false;
    if (!already.length) {
        const url = String(opts?.url ?? ctx.fns.procs.db.url());
        await ctx.fns.duckdb.run({ sql: "INSTALL postgres", timeout: 120 });
        await ctx.fns.duckdb.run({ sql: "LOAD postgres" });
        // The URL carries a password, so it must not end up in an error message
        // or a log line; this is the only place it is interpolated.
        const quoted = url.replaceAll("'", "''");
        try {
            await ctx.fns.duckdb.run({ sql: `ATTACH '${quoted}' AS ${alias} (TYPE postgres${opts?.writable ? "" : ", READ_ONLY"})`, timeout: 60 });
        } catch (error: any) {
            throw new Error(`duckdb.pg: could not attach ${alias}: ${String(error?.message ?? error).replaceAll(url, "<url>")}`);
        }
        attached = true;
    }

    const tables = await ctx.fns.duckdb.run({ sql: `SELECT table_name FROM ${alias}.information_schema.tables WHERE table_schema = 'public' ORDER BY table_name` });
    return { alias, attached, tables: tables.map((row: any) => String(row.table_name)) };
}
