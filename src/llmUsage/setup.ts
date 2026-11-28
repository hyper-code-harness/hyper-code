/**
 * Create the metadata-only LLM accounting tables after explicit owner confirmation
 *
 * Use once when an instance owner approves provisioning the local accounting schema. Re-authenticates the actual HTTP owner, creates only the two ledger tables and indexes idempotently, and never enables collection, imports historical logs, stores request contents or deletes existing data. Not registered as a startup migration; ordinary reloads cannot provision it.
 * @param opts.confirmed Must be exactly true after the instance owner confirms creation of the accounting tables. This does not consent to enabling collection.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Must be exactly true after the instance owner confirms creation of the accounting tables. This does not consent to enabling collection. */
        confirmed: boolean;
    },
): Promise<{ provisioned: true }> {
    await ctx.fns.llmUsage.adminAccess({});
        if (opts.confirmed !== true) throw new Error("Creating the LLM accounting tables requires explicit owner confirmation");
        await ctx.fns.procs.db.transaction({fn: async () => {
            await ctx.fns.procs.db.exec({sql: "\n            CREATE TABLE IF NOT EXISTS llm_usage_calls (\n                id UUID PRIMARY KEY,\n                source TEXT NOT NULL CHECK (source IN ('local','node')),\n                operation TEXT NOT NULL CHECK (operation IN ('call','stream','compact','relay')),\n                agent_id TEXT,\n                client_id TEXT,\n                client_name TEXT,\n                requested_model TEXT,\n                remote BOOLEAN NOT NULL DEFAULT false,\n                started_at BIGINT NOT NULL,\n                finished_at BIGINT,\n                status TEXT NOT NULL CHECK (status IN ('pending','success','error','cancelled'))\n            );\n            CREATE TABLE IF NOT EXISTS llm_usage_attempts (\n                id UUID PRIMARY KEY,\n                call_id UUID NOT NULL REFERENCES llm_usage_calls(id) ON DELETE CASCADE,\n                provider TEXT,\n                account TEXT,\n                model TEXT,\n                api TEXT NOT NULL CHECK (api IN ('anthropic','responses','openai','sdk')),\n                remote BOOLEAN NOT NULL DEFAULT false,\n                started_at BIGINT NOT NULL,\n                finished_at BIGINT,\n                status TEXT NOT NULL CHECK (status IN ('pending','success','error','cancelled')),\n                http_status INTEGER,\n                input_tokens BIGINT CHECK (input_tokens >= 0),\n                output_tokens BIGINT CHECK (output_tokens >= 0),\n                cache_read_tokens BIGINT CHECK (cache_read_tokens >= 0),\n                cache_write_tokens BIGINT CHECK (cache_write_tokens >= 0),\n                usage_state TEXT NOT NULL CHECK (usage_state IN ('known','partial','unknown'))\n            );\n            CREATE INDEX IF NOT EXISTS llm_usage_calls_time ON llm_usage_calls(started_at DESC);\n            CREATE INDEX IF NOT EXISTS llm_usage_calls_client_time ON llm_usage_calls(client_id, started_at DESC);\n            CREATE INDEX IF NOT EXISTS llm_usage_calls_agent_time ON llm_usage_calls(agent_id, started_at DESC);\n            CREATE INDEX IF NOT EXISTS llm_usage_attempts_call ON llm_usage_attempts(call_id);\n            CREATE INDEX IF NOT EXISTS llm_usage_attempts_model_time ON llm_usage_attempts(provider, account, model, started_at DESC);\n        "});
        }});
        return { provisioned: true as const };
}
