// How much RAM the in-process DuckDB may use before it spills to disk. Empty
// means DuckDB's own default (about 80% of system memory), which is generous
// for an engine sharing the process with the server.
export default {
    type: 'string',
    env: 'DUCKDB_MEMORY_LIMIT',
    default: '2GB',
    title: 'DuckDB memory limit',
    description: "Memory budget for the in-process engine, as DuckDB spells it ('2GB', '512MB'). Empty means DuckDB's own default.",
};
