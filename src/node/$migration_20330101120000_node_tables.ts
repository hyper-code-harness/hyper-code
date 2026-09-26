// Hyper-to-Hyper model sharing (docs/hyper-node.md).
//   llm_node_clients — who may relay through THIS instance (host side)
//   llm_nodes        — other instances THIS instance relays through (client side)
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `
CREATE TABLE IF NOT EXISTS llm_node_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL,
    providers TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL,
    last_used_at BIGINT,
    requests BIGINT NOT NULL DEFAULT 0,
    revoked_at BIGINT
);
CREATE TABLE IF NOT EXISTS llm_nodes (
    name TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    catalog TEXT,
    catalog_at BIGINT,
    usage TEXT,
    usage_at BIGINT,
    last_error TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);` });
    },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS llm_node_clients; DROP TABLE IF EXISTS llm_nodes" }); },
};
