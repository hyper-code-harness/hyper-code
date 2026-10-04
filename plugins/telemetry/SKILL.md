---
name: telemetry
description: Paged NDJSON span storage with parquet compaction, DuckDB queries and a performance dashboard over the built-in tracer.
---

# Telemetry

The runtime's built-in tracer (`procs/telemetry`) records a span for every
database query, LLM request and tool execution into NDJSON. This plugin owns
everything after that: paging, compaction, retention, queries and the
dashboard at `/telemetry`.

It is a core plugin — mounted by default, no `optional` flag — because an
install that is not paging its spans grows one unbounded file. This machine had
reached 11 GB in a single `telemetry.ndjson` before the plugin existed.

## Storage model

Three tiers under `.runtime/telemetry/`:

| Tier | Path | Lifetime |
| --- | --- | --- |
| Open page | `open/spans-<day>-<pid>.ndjson` | the file the tracer appends to right now |
| Closed pages | `pages/*.ndjson` | immutable, awaiting compaction |
| Cold | `cold/dt=YYYY-MM-DD/*.parquet` | zstd parquet, hive-partitioned by day |

A page is closed when it exceeds `pageBytes` (64 MB) or crosses a day, then
converted to parquet and deleted. Compression is roughly 20×: 64 MB of NDJSON
becomes ~3.3 MB of parquet, and the whole 11 GB history compacted to 592 MB.
`prune` drops partitions older than `coldRetentionDays` (90).

Queries read both tiers through one union expression from `spanSource`, so a
span is visible the moment it is written and stays visible after compaction.

## Workflow

Inspect current performance without opening the UI:

```ts
const s = await ctx.fns.telemetry.stats({ hours: 24, limit: 10 });
s.routes[0]        // slowest route by total wall time
s.queries[0]       // heaviest normalized SQL statement
s.slow             // recent slow or failed spans
```

Check what storage costs and force a maintenance pass:

```ts
await ctx.fns.telemetry.storage({});           // bytes per tier, partition range
await ctx.fns.telemetry.maintain({ force: true }); // rotate + compact + prune
```

Ask an arbitrary question over the spans:

```ts
const src = await ctx.fns.telemetry.spanSource({});
await ctx.fns.telemetry.duck({ sql: `SELECT Name, count(*) FROM ${src.sql} GROUP BY 1` });
```

Attributes are JSON, so quote the dotted keys:
`Attributes->>'$."http.route"'`, `'$."db.query.summary"'`, `'$."llm.model"'`.

## Two views of the database

`stats().queries` is the client side: how long the application waited, measured
by the tracer's spans. `pgStats()` is the server side, from
`pg_stat_statements`: execution time, rows per call and shared-buffer hit
ratio. The gap between them is where connection-pool waits and N+1 live, and a
low cache hit percent on a heavy statement is the usual reason a query that
looks cheap in isolation costs minutes a day.

`pg_stat_statements` must be installed *and* listed in
`shared_preload_libraries`. When it is not, `pgStats` returns
`{ available: false, reason }` and the dashboard prints the reason.

Changing `shared_preload_libraries` restarts the whole Postgres instance that
every agent depends on. Put it in the compose file
(`command: -c shared_preload_libraries=...`) and ask the user before
restarting — never `ALTER SYSTEM` it from a REPL, and never with the list
wrapped in one pair of quotes: that writes a single literal file name and the
server then refuses to start.

## Retention

Parquet partitions older than `coldRetentionDays` (default **7**) are deleted
by `prune`, which `maintain` calls on its timer. A week is enough to find a
regression while keeping the cost bounded; raise it when a longer baseline
matters.

## Notes

- DuckDB is required for queries and compaction. Without it the dashboard says
  so and the tracer keeps writing NDJSON — observability never takes down the
  thing it observes.
- Query summaries are normalized: literals and numbers are replaced with `?`
  before a span is written, so no parameter value ever reaches disk.
- `maintain` runs on a timer from `$start` every `maintainMs` (5 minutes).
