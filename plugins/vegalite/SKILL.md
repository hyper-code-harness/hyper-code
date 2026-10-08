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

Turning `allowRemoteData` on makes any rendered fence able to reach whatever the spec names, from this machine. Leave it off unless charts come from a source you control.
