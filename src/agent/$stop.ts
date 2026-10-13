/**
 * Stops the agent worker and attachment producers during shutdown.
 *
 * The worker goes first and for real: a process whose HTTP server and cron
 * are gone but whose worker loop still claims agents is the orphan that kept
 * running agents on stale code for days. Runs owned by this process are handed
 * back to the queue at once (revoked and rescheduled) so the next process picks
 * them up immediately instead of after the 10-minute stale lease.
 */
export default async function (ctx: Context, _session: Session | null, _state?: unknown) {
    const st = ctx.state as any;
    st.workerLoopRunning = false;
    try { ctx.fns.agent.wakeWorker({}); } catch {}

    const now = Date.now();
    for (const agent of Object.values(st.agent ?? {}) as any[]) {
        const token = agent?.currentJobId;
        if (!token) continue;
        try {
            await ctx.fns.procs.db.run({
                sql: `UPDATE agents SET run_state = 'idle', run_started_at = NULL, run_heartbeat_at = NULL,
                        run_token = NULL, next_run_at = COALESCE(next_run_at, ?), updated_at = ?
                      WHERE id = ? AND run_token = ?`,
                params: [now + 1_000, now, agent.id, token],
            });
        } catch (error: any) {
            console.error(`[agent.stop] could not hand back ${agent.id}:`, error?.message ?? error);
        }
        agent.currentJobId = null;
        try { agent.abortController?.abort('shutdown'); } catch {}
    }

    // Let the loop settle its finalizers (fenced by the revoked tokens) and
    // release the database lock, but never hold shutdown hostage to a tool.
    const loop: Promise<unknown> | undefined = st.workerLoopPromise;
    if (loop) await Promise.race([loop, Bun.sleep(3_000)]);
    if (st.workerLock) {
        try { st.workerLock.release(); } catch {}
        st.workerLock = null;
    }
    await ctx.fns.agent.stopUnusedAttachments({ all: true });
}
