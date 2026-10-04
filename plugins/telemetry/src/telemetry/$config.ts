// Paging policy for span storage. The built-in tracer (procs/telemetry) writes
// NDJSON; this plugin decides when a page is closed, when it becomes parquet
// and how long each tier is kept. Nothing here touches Postgres.
export default {
    /** Close the open page once it reaches this many bytes. */
    pageBytes: { type: "integer", default: 67108864, env: "TELEMETRY_PAGE_BYTES" },
    /** Close the open page when it crosses a calendar day, even if it is small. */
    pageByDay: { type: "boolean", default: true, env: "TELEMETRY_PAGE_BY_DAY" },
    /** How often rotation, compaction and pruning run, in milliseconds. */
    maintainMs: { type: "integer", default: 300000, env: "TELEMETRY_MAINTAIN_MS" },
    /** Days of compacted parquet to keep; 0 keeps everything. A week is enough
     *  to find a regression and bound the disk; raise it for a long baseline. */
    coldRetentionDays: { type: "integer", default: 7, env: "TELEMETRY_COLD_DAYS" },
    /** DuckDB binary used for compaction and queries. */
    duckdbBin: { type: "string", default: "duckdb", env: "DUCKDB_BIN" },
    /** Seconds a DuckDB process may run before it is killed. */
    duckdbTimeout: { type: "integer", default: 300, env: "TELEMETRY_DUCKDB_TIMEOUT" },
} as const satisfies ConfigSchema;
