// DuckDB runs queries on its own thread pool inside this process. Leaving it
// at 0 lets DuckDB use every core, which can starve the server under a heavy
// scan; a small number keeps the UI responsive.
export default {
    type: 'number',
    env: 'DUCKDB_THREADS',
    default: 4,
    title: 'DuckDB threads',
    description: 'Worker threads the in-process engine may use. 0 means every core, which can make the server unresponsive during a big scan.',
};
