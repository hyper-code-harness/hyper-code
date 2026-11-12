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
    // …and the tool calls it has in flight. Each call has its own controller (tools.beginRun), so aborting the run
    // alone left a bash or a fetch started before the press running to its own end, its spinner still turning.
    // Each reports "stopped by the user", as the per-call abort button does. Background jobs are not calls (a
    // background bash returns its job id at once; afterMs only waits for one; "to background" hands the process to
    // jobs.adopt and ends the call), so they keep running — jobs.cancel stops those.
    for (const run of ctx.fns.tools?.runs?.({ agentId: agent.id }) ?? []) {
        try { ctx.fns.tools.abortRun({ id: run.id }); } catch (error: any) { console.warn(`agent.stop: abort ${run.id} failed:`, error?.message ?? error); }
    }

    // Reset run state on the agent row. clearQueue also drops the pending debounce window.
    // An explicit user stop pauses plan continuation. It is resumed only by a
    // new user run or a new plan, never by automatic recovery.
    agent.scratchpad ??= {};
    if (agent.scratchpad.plan && !agent.scratchpad.plan.pausedAt) {
        await ctx.fns.session.pausePlan({ agent, reason: 'user' });
    }

    await ctx.fns.procs.db.run({
        sql: `UPDATE agents
            SET run_state = 'idle',
                run_started_at = NULL,
                run_heartbeat_at = NULL,
                run_token = NULL,
                next_run_at = ${clearQueue ? 'NULL' : 'next_run_at'},
                last_error = NULL,
                updated_at = ?
          WHERE id = ?`,
        params: [now, agent.id],
    });

    agent.samplingAbortController = null;
    agent.abortController = null;
    agent.isStreaming = false;
    // A stop is the person's own action, not a failure: one quiet grey line in the transcript, no red toast
    // and no error badge (renderEventHtml draws type "stopped").
    await ctx.fns.session.appendEventWithHtml({ id: agent.id, type: 'stopped', payload: { clearQueue } });
    await ctx.fns.session?.syncAgentState?.({ agent });
    return { ok: true, clearQueue };
}
