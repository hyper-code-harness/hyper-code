// A ```duckdb fence runs its SQL when the Markdown around it is rendered, and
// DuckDB can read any file this server can reach. That is useful in a notebook
// the user writes and dangerous in a document that arrived from elsewhere, so
// the decision is the user's and the default is no.
export default {
    type: 'boolean',
    env: 'DUCKDB_ALLOW_FENCE',
    default: false,
    title: 'Run ```duckdb fences in Markdown',
    description: 'Execute the SQL inside a ```duckdb fence while rendering Markdown and show the table or chart. Leave off if Markdown from untrusted sources is rendered here.',
};
