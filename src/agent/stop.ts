/** Stop for the runtime.  * @param opts.agent Agent whose state is read or updated.
 * @param opts.clearQueue Whether to discard queued work.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Live agent instance to operate on. */
agent: types.agent.Agent;
        /** Clear queue used by the operation. */
clearQueue?: boolean }) {
    const { agent } = opts;
    const clearQueue = opts.clearQueue === true;
    const now = Date.now();

    // Abort the in-flight LLM call if any.
    try { agent.samplingAbortController?.abort('stopped_by_user'); } catch {}
    try { agent.abortController?.abort('stopped_by_user'); } catch {}

    // Reset run state on the agent row. clearQueue also drops the pending debounce window.
    // An explicit user stop pauses plan continuation. It is resumed only by a
    // new user run or a new plan, never by automatic recovery.
    agent.scratchpad ??= {};
    if (agent.scratchpad.plan && !agent.scratchpad.plan.pausedAt) {
        const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, ts: number) => {
            const plan = scratchpad.plan;
            if (!plan || plan.pausedAt) return;
            const task = Array.isArray(plan.tasks) ? plan.tasks.find((item: any) => item.status === 'active') : null;
            if (task?.activeSince) {
                task.elapsedMs = Math.max(0, Number(task.elapsedMs ?? 0)) + Math.max(0, ts - Number(task.activeSince));
                task.activeSince = null;
            }
            plan.pausedAt = ts;
            plan.updatedAt = ts;
        } });
        agent.scratchpad = updated.scratchpad;
        ctx.fns.events?.refreshAgentMeta?.({ agentId: agent.id, reason: 'plan-paused' });
    }

    await ctx.fns.procs.db.run({
        sql: `UPDATE agents
            SET run_state = 'idle',
                run_started_at = NULL,
                run_heartbeat_at = NULL,
                run_token = NULL,
                next_run_at = ${clearQueue ? 'NULL' : 'next_run_at'},
                last_error = ?,
                updated_at = ?
          WHERE id = ?`,
        params: [clearQueue ? 'stopped by user; queue cleared' : 'stopped by user', now, agent.id],
    });

    agent.samplingAbortController = null;
    agent.abortController = null;
    agent.isStreaming = false;
    await ctx.fns.session?.appendErrorEvent?.({ id: agent.id, error: clearQueue ? 'stopped by user; queue cleared' : 'stopped by user' });
    await ctx.fns.session?.syncAgentState?.({ agent });
    return { ok: true, clearQueue };
}
