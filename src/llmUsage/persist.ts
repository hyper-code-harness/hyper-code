/**
 * Persist only an internally minted usage scope or attempt with a bounded fail-open wait.
 *
 * Internal ledger writer. Rejects objects not minted in this context, stores only allowlisted columns, never persists payloads or errors, and disables accounting for this scope after any write failure. At most sixteen unresolved writes and a 150 millisecond caller wait prevent accounting from blocking provider requests.
 * @param opts.scope Context-owned logical invocation identity; externally reconstructed objects are rejected.
 * @param opts.attempt Context-owned provider attempt to upsert instead of the logical call.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Context-owned logical invocation identity; externally reconstructed objects are rejected. */
        scope: types.llmUsage.Scope;
        /** Context-owned provider attempt to upsert instead of the logical call. */
        attempt?: types.llmUsage.Attempt;
    },
): Promise<boolean> {
    const st = await ctx.fns.llmUsage.getState({});
    const s = opts.scope, a = opts.attempt;
    if (!st.scopes.has(s) || s.broken || (a && (!st.attempts.has(a) || a.scope !== s))) return false;
    if (st.writes >= 16) { s.broken = true; return false; }
    let sql: string, params: (string | number | boolean | null)[];
    if (a) {
        sql = "INSERT INTO llm_usage_attempts (id,call_id,provider,account,model,api,remote,started_at,finished_at,status,http_status,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,usage_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET finished_at=EXCLUDED.finished_at,status=EXCLUDED.status,http_status=EXCLUDED.http_status,input_tokens=EXCLUDED.input_tokens,output_tokens=EXCLUDED.output_tokens,cache_read_tokens=EXCLUDED.cache_read_tokens,cache_write_tokens=EXCLUDED.cache_write_tokens,usage_state=EXCLUDED.usage_state WHERE llm_usage_attempts.status='pending'";
        params = [a.id,s.id,a.provider,a.account,a.model,a.api,a.remote,a.startedAt,a.finishedAt,a.status,a.httpStatus,a.inputTokens,a.outputTokens,a.cacheReadTokens,a.cacheWriteTokens,a.usageState];
    } else {
        sql = "INSERT INTO llm_usage_calls (id,source,operation,agent_id,client_id,client_name,requested_model,remote,started_at,finished_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO UPDATE SET finished_at=EXCLUDED.finished_at,status=EXCLUDED.status,remote=EXCLUDED.remote WHERE llm_usage_calls.status='pending'";
        params = [s.id,s.source,s.operation,s.agentId,s.clientId,s.clientName,s.requestedModel,s.remote,s.startedAt,s.finishedAt,s.status];
    }
    st.writes++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve().then(()=>ctx.fns.procs.db.run({sql,params})).then(() => true, () => false).finally(() => { st.writes--; });
    const ok = await Promise.race([pending, new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 150); })]);
    if (timer) clearTimeout(timer);
    if (!ok) s.broken = true;
    if (a) a.persisted = ok; else s.persisted = ok;
    return ok;
}
