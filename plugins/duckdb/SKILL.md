---
name: duckdb
description: "Query local NDJSON/JSONL logs, JSON, CSV, Parquet, DuckDB files and the project's own Postgres with SQL, and turn a result straight into a Markdown table or a chart. Use for log filtering, aggregation, schema discovery, timelines, error analysis, ad-hoc analytics and quick visual answers."
---

# duckdb

Runs DuckDB **in this process** through `@duckdb/node-api` — no subprocess, so a query costs microseconds instead of ~14 ms, and the catalogue survives between calls: a view created now is still there in the next call, and an ATTACHed database stays attached. Relative paths resolve in the current agent workspace. Without the native module the plugin falls back to the `duckdb` CLI, which works for single file queries but keeps no state.

## Workflow

1. `duckdb.inspect({ path })` — format, columns, types, row count, sample rows.
2. `duckdb.ndjson({ path, where?, select?, groupBy?, orderBy?, limit? })` — common file analysis without writing a full query. Despite the name it also reads JSON, CSV, TSV and Parquet.
3. `duckdb.query({ sql, params?, maxRows? })` — arbitrary read-only SQL: joins, windows, several files at once.
4. `duckdb.table({ sql })` / `duckdb.chart({ sql, x, y })` — the same result formatted for a person.

```ts
await ctx.fns.duckdb.query({
  sql: `SELECT name, count(*) n FROM read_ndjson_auto('.runtime/telemetry.ndjson')
        WHERE status = ? GROUP BY name ORDER BY n DESC`,
  params: ["error"],
});
```

## Results people read

- `duckdb.table({ sql, maxRows?, maxWidth? })` → an aligned Markdown table. Numbers are right-aligned and grouped, ISO timestamps are shortened, truncation is stated rather than hidden.
- `duckdb.chart({ sql, mark?, x?, y?, color?, title?, sort?, width?, height?, spec? })` → inline SVG through the **vegalite** plugin plus the generated spec. Channel types come from the result: text is a category, numbers a quantity, a date column a time axis. `spec` is merged over the generated one for anything else.

```ts
await ctx.fns.duckdb.chart({
  sql: "SELECT level, count(*) n FROM read_ndjson_auto('log.ndjson') GROUP BY 1",
  x: "level", y: "n", sort: true, title: "Log levels",
});
```

## State that persists

- `duckdb.exec({ sql })` — the deliberate counterpart to `query`: `CREATE VIEW`/`TABLE`, `INSTALL`/`LOAD`, `ATTACH`, `COPY ... TO 'out.parquet'`. Returns the catalogue afterwards. Build a view once, then query it by name all session.
- `duckdb.pg({})` — attaches this project's Postgres read-only as `pg`. After that `SELECT ... FROM pg.public.agents` works, and a Postgres table can be joined against a local Parquet file. Attaching twice is a no-op. Note that `duckdb.query` refuses `ATTACH` itself, which is why this is its own function.
- `duckdb.conn({ db? })` — the raw instance, for code that needs the native API directly.

## Markdown fences

A ```` ```duckdb ```` fence runs its SQL while the Markdown renders and shows the result. The info string picks the output: `chart=bar x=level y=n title="Log levels"`, or nothing for a table with `rows=20`. **Off by default** (`duckdb.allowFence`) — DuckDB reads any file the server can, so a document from elsewhere must not run queries unasked.

The same applies the other way round: a `vega-lite` fence may use `data: { sql: "..." }`, which runs through this plugin, and that needs `vegalite.allowSqlData`.

## Limits

`query` rejects write, DDL, extension and attach statements by keyword — analytics, not mutation. Rows are capped by `maxRows` and the result says whether anything was cut. A timeout interrupts the query and leaves the engine usable. Values are normalized for JSON: BigInt becomes a number (a string when it would lose precision), dates become ISO strings, blobs base64.

Settings: `duckdb.memoryLimit` (default `2GB`), `duckdb.threads` (default 4 — DuckDB shares the process with the server, so letting it take every core makes the UI stutter during a big scan), `duckdb.allowFence`.
