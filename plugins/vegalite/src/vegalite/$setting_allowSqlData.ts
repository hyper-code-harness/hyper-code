// `data: { sql: "..." }` runs the query through the duckdb plugin. DuckDB can
// read any file the server can — `read_csv_auto('/etc/hosts')` is a valid
// query — so this deliberately escapes the data root, and a Markdown fence from
// an untrusted document must not be able to do it by default.
export default {
    type: 'boolean',
    env: 'VEGALITE_ALLOW_SQL_DATA',
    default: false,
    title: 'Allow SQL data in charts',
    description: 'Let a chart spec use data: { sql } and run it read-only through DuckDB. DuckDB reads outside the data root, so leave this off if Markdown from untrusted sources is rendered here.',
};
