/**
 * Cancels all pending durable triggers for an agent
 *
 * Cancel every active or currently checking time, cron and condition trigger owned by one agent. Use when stopping all deferred autonomous work for that agent.
 * @param opts.id Agent whose triggers should be cancelled.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose triggers should be cancelled. */
        id: string;
    },
): Promise<{ cancelled: number }> {
    const now=Date.now();const r=await ctx.fns.procs.db.run({sql:"UPDATE agent_triggers SET status='cancelled',next_at=NULL,claim_token=NULL,claimed_at=NULL,updated_at=?,finished_at=? WHERE agent_id=? AND status IN ('active','checking')",params:[now,now,opts.id]});ctx.fns.agent.wakeWorker({});return{cancelled:r.changes};
}
