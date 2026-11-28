/** Metadata-only usage ledger; enabling accounting is a separate explicit action. */
export default {
    up: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: `
            CREATE TABLE IF NOT EXISTS llm_usage_calls (
                id UUID PRIMARY KEY,
                source TEXT NOT NULL CHECK (source IN ('local','node')),
                operation TEXT NOT NULL CHECK (operation IN ('call','stream','compact','relay')),
                agent_id TEXT,
                client_id TEXT,
                client_name TEXT,
                requested_model TEXT,
                remote BOOLEAN NOT NULL DEFAULT false,
                started_at BIGINT NOT NULL,
                finished_at BIGINT,
                status TEXT NOT NULL CHECK (status IN ('pending','success','error','cancelled'))
            );
            CREATE TABLE IF NOT EXISTS llm_usage_attempts (
                id UUID PRIMARY KEY,
                call_id UUID NOT NULL REFERENCES llm_usage_calls(id) ON DELETE CASCADE,
                provider TEXT,
                account TEXT,
                model TEXT,
                api TEXT NOT NULL CHECK (api IN ('anthropic','responses','openai','sdk')),
                remote BOOLEAN NOT NULL DEFAULT false,
                started_at BIGINT NOT NULL,
                finished_at BIGINT,
                status TEXT NOT NULL CHECK (status IN ('pending','success','error','cancelled')),
                http_status INTEGER,
                input_tokens BIGINT CHECK (input_tokens >= 0),
                output_tokens BIGINT CHECK (output_tokens >= 0),
                cache_read_tokens BIGINT CHECK (cache_read_tokens >= 0),
                cache_write_tokens BIGINT CHECK (cache_write_tokens >= 0),
                usage_state TEXT NOT NULL CHECK (usage_state IN ('known','partial','unknown'))
            );
            CREATE INDEX IF NOT EXISTS llm_usage_calls_time ON llm_usage_calls(started_at DESC);
            CREATE INDEX IF NOT EXISTS llm_usage_calls_client_time ON llm_usage_calls(client_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS llm_usage_calls_agent_time ON llm_usage_calls(agent_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS llm_usage_attempts_call ON llm_usage_attempts(call_id);
            CREATE INDEX IF NOT EXISTS llm_usage_attempts_model_time ON llm_usage_attempts(provider, account, model, started_at DESC);
        ` });
    },
    down: async (ctx: Context) => {
        await ctx.fns.procs.db.exec({ sql: "DROP TABLE IF EXISTS llm_usage_attempts; DROP TABLE IF EXISTS llm_usage_calls;" });
    },
};
