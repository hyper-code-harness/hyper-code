const upSql = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS skill_docs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pack TEXT NOT NULL,
    source TEXT NOT NULL,
    trust TEXT NOT NULL DEFAULT 'community',
    model_allowed BOOLEAN NOT NULL DEFAULT false,
    description TEXT NOT NULL DEFAULT '',
    dir TEXT NOT NULL,
    model_invocable BOOLEAN NOT NULL DEFAULT true,
    user_invocable BOOLEAN NOT NULL DEFAULT true,
    argument_hint TEXT,
    files JSONB NOT NULL DEFAULT '[]',
    diagnostics JSONB NOT NULL DEFAULT '[]',
    body_chars INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '',
    embedding public.halfvec(1536),
    embedding_provider TEXT,
    embedding_model TEXT,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS skill_docs_bm25 ON skill_docs USING bm25
    (id, name, description, search_text) WITH (key_field = 'id');
CREATE INDEX IF NOT EXISTS skill_docs_embedding_hnsw ON skill_docs
    USING hnsw (embedding public.halfvec_cosine_ops);
CREATE INDEX IF NOT EXISTS skill_docs_name ON skill_docs (name);
CREATE TABLE IF NOT EXISTS skill_usage (
    id BIGSERIAL PRIMARY KEY,
    ts BIGINT NOT NULL,
    skill_id TEXT NOT NULL,
    agent_id TEXT,
    via TEXT NOT NULL,
    content_hash TEXT
);
CREATE INDEX IF NOT EXISTS skill_usage_skill_ts ON skill_usage (skill_id, ts);
`;

/** Creates the Agent Skills search index (one row per skill) and the usage log (one row per load, no message text). */
export default {
    up: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: upSql }); },
    down: async (ctx: Context) => { await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS skill_usage; DROP TABLE IF EXISTS skill_docs" }); },
};
