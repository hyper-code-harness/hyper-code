---
name: vegalite
description: "Render Vega-Lite charts to static inline SVG. Use when an answer, a document or a page needs a real chart from data — write a ```vega-lite fence with a JSON spec, or call vegalite.render. Data may be inline values or a local CSV/JSON/NDJSON file under the data root. For diagrams of boxes and arrows use mermaid or reladraw instead."
---

# vegalite

Compiles a Vega-Lite spec with `vega-lite`, renders it headlessly with `vega`, and returns an SVG. Static by design: no JavaScript reaches the page, so a chart works in chat, in saved HTML and in a document that is read offline. Tooltips, zoom and selections are not rendered.

## Use

In Markdown — the fence renders inline, and a spec that fails to compile stays visible as code:

````markdown
```vega-lite width=520 height=220
{
  "data": { "values": [{"m": "Jan", "sales": 120}, {"m": "Feb", "sales": 180}] },
  "mark": "bar",
  "encoding": { "x": {"field": "m", "type": "nominal"}, "y": {"field": "sales", "type": "quantitative"} }
}
```
````

The fence info string takes `width=`, `height=` and `theme=off`.

From code:

- `vegalite.render({ spec, width?, height?, theme? })` → `{ html, svg, sources, warnings }`. `spec` is an object or a JSON string; `sources` lists the data files it read.
- `vegalite.readData({ path, format?, limit? })` → parsed rows of a local CSV/TSV/JSON/NDJSON file; the one way to see what a spec's `url` will actually get.
- `vegalite.resolveDataPath({ path })` → the absolute path, or a throw if it leaves the data root.
- `vegalite.theme({})` → the Vega config with the host font and palette, if you compile a spec yourself.

## Executable object expressions (`vega-lite eval`)

With `vegalite.allowEval` explicitly enabled, use `eval` in the fence info string.
The body is a **JavaScript object expression**, not JSON: unquoted keys, expressions,
`await`, `ctx` and `session` are available. It is wrapped as an async return expression
and its resulting object is passed to Vega-Lite. Do not write a top-level `return`
or a trailing semicolon. This mode is JavaScript, not TypeScript.

**Security and lifecycle:** disabled by default. This is full server-side code execution,
not a sandbox, and read-only behavior is not enforced. Enable only when all rendered
Markdown is trusted. Use read-only calls; never send messages, write files, mutate data,
or access secrets in a chart. Expressions run again on every render, including reopening
history; results are not a saved snapshot. Ordinary fences remain strict JSON. Width,
height and theme flags also work in eval mode. Runtime or syntax errors fall back to code.
The system-context fence hint advertises eval only while the setting is enabled.

### Postgres (framework connection)

````markdown
```vega-lite eval width=520 height=300
{
  data: {
    values: await ctx.fns.procs.db.select({
      sql: "SELECT sender_full_name AS name, COUNT(*)::int AS messages FROM fhir.zulip_messages GROUP BY sender_full_name ORDER BY messages DESC LIMIT ?",
      params: [10]
    })
  },
  mark: 'bar',
  encoding: {
    y: { field: 'name', type: 'nominal', sort: '-x' },
    x: { field: 'messages', type: 'quantitative' }
  }
}
```
````

This example requires the FHIR mirror. Always use `ctx.fns.procs.db`, not bare Bun.sql.

### DuckDB

````markdown
```vega-lite eval
{
  data: {
    values: (await ctx.fns.duckdb.query({
      sql: "SELECT 'Jan' AS month, 120 AS sales UNION ALL SELECT 'Feb', 180"
    })).rows
  },
  mark: 'bar',
  encoding: {
    x: { field: 'month', type: 'nominal' },
    y: { field: 'sales', type: 'quantitative' }
  }
}
```
````

Requires the DuckDB plugin. Direct function calls use their own permissions;
`allowSqlData` only gates the declarative `data: { sql }` syntax, not eval calls.

### DuckDB over a local CSV (OMOP example)

Inspect the CSV's columns and a few rows with `duckdb.query` before writing a chart.
Start with `read_csv_auto`; verify it detected separate columns rather than treating
an entire line as one field. Use an actual absolute path on the server, not `~`.
The path below is a placeholder: replace it with your local OMOP CDM CSV.

````markdown
```vega-lite eval width=480 height=320
{
  title: 'Largest OMOP tables · Number of fields',
  data: {
    values: (await ctx.fns.duckdb.query({
      sql: `SELECT cdmTableName AS name, count(*) AS fields
            FROM read_csv('/absolute/path/OMOP_CDMv5.4_Field_Level.csv',
              delim=',', header=true, quote='"', escape='"',
              null_padding=true, strict_mode=false, parallel=false)
            GROUP BY cdmTableName
            ORDER BY fields DESC, name LIMIT 12`
    })).rows
  },
  mark: 'bar',
  encoding: {
    y: { field: 'name', type: 'nominal', sort: '-x', title: null,
         axis: { labelLimit: 190 } },
    x: { field: 'fields', type: 'quantitative', title: 'Fields' }
  }
}
```
````

These parsing options were needed for an OMOP CDM 5.4 field dictionary with
quoted multiline guidance and uneven row widths; they are not universal defaults:

- `delim`, `quote`, and `escape` explicitly describe comma-separated, quoted CSV.
- `null_padding=true` fills missing trailing columns with NULL.
- `strict_mode=false` relaxes structural checks; inspect the parsed rows before trusting counts.
- `parallel=false` is needed when combining null padding with quoted newlines.
- Do not silently add `ignore_errors=true`: dropping rows can produce misleading charts.

DuckDB may infer `Yes`/`No` columns such as `isRequired` as BOOLEAN. Check the
inferred type; in that case use `CASE WHEN isRequired THEN 'Required' ELSE 'Optional' END`,
not a string comparison. This chart describes schema fields, not patient counts.
Direct DuckDB file access is not confined by Vega-Lite's `dataRoot` setting.

### A regular runtime function call

````markdown
```vega-lite eval
{
  data: { values: [await ctx.fns.fhir.stats({})] },
  mark: 'bar',
  encoding: { y: { field: 'messages', type: 'quantitative' } }
}
```
````

Any read-only function returning rows can supply `data.values`; for a single record,
wrap it in an array as above. Transform rows with ordinary JavaScript when needed.

## Data

A spec may use inline `data: { values: [...] }`, or `data: { url: "reports/sales.csv" }`. Urls are resolved **before** rendering: every file is read, parsed and inlined, so Vega's own loader never runs and a displayed chart cannot make this server issue a request.

- Relative urls resolve under the **data root** and may not escape it. `../`, absolute paths outside it and non-file schemes are refused with the path named.
- With `vegalite.dataRoot` empty the root is the **calling agent's workspace directory** — the same relative paths its files, bash and git tools use — and the project root when there is no agent (tests, scripts, the HTTP route) or when the workspace lives on an SSH host. Setting `vegalite.dataRoot` pins one tree for everybody and outranks the workspace.
- CSV, TSV, JSON and NDJSON are inferred from the extension; `format: { type }` overrides.
- `GET /vegalite/data?path=reports/sales.csv` serves one file for the browser side, `&rows=1` returns parsed rows as JSON, `&limit=N` caps them. Same confinement, same size cap.

### SQL data

With the **duckdb** plugin mounted and `vegalite.allowSqlData` on, a spec may say `data: { sql: "SELECT ..." }` — the query runs read-only through DuckDB and its rows are inlined like any other source. That covers a chart straight from a Parquet file or from the attached Postgres (`duckdb.pg({})`), without a staging file:

```json
{ "data": { "sql": "SELECT level, count(*) AS n FROM read_ndjson_auto('log.ndjson') GROUP BY 1" },
  "mark": "bar",
  "encoding": { "x": {"field": "level", "type": "nominal"}, "y": {"field": "n", "type": "quantitative"} } }
```

It is off by default because DuckDB reads any file this server can, which deliberately escapes the data root. `duckdb.chart({ sql, x, y })` does the same thing from the other side and writes the spec for you.

## Settings

| setting | default | meaning |
|---|---|---|
| `vegalite.dataRoot` | agent workspace, else project root | the only tree charts and the data route may read |
| `vegalite.allowRemoteData` | `false` | let specs fetch `https://` data; off means a remote url is an error |
| `vegalite.maxDataBytes` | 8 MiB | largest data file a chart may read |
| `vegalite.allowSqlData` | `false` | let specs use `data: { sql }` through the duckdb plugin |
| `vegalite.allowEval` | `false` | execute trusted JavaScript object expressions in `vega-lite eval` fences; full server privileges, reruns on render |

Turning `allowRemoteData` on makes any rendered fence able to reach whatever the spec names, from this machine. Leave it off unless charts come from a source you control.
