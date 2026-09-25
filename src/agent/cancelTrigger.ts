/**
 * Cancels one durable agent trigger
 *
 * Cancel one pending time, cron or condition trigger owned by the specified agent. Cancellation is idempotent and a trigger already being checked will not deliver after its claim is invalidated.
 * @param opts.id Owning agent identifier.
 * @param opts.triggerId Trigger identifier returned by wake, cron or watch.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Owning agent identifier. */
        id: string;
        /** Trigger identifier returned by wake, cron or watch. */
        triggerId: string;
    },
): Promise<{ cancelled: boolean }> {
    const now=Date.now();const r=await ctx.fns.procs.db.run({sql:"UPDATE agent_triggers SET status='cancelled',next_at=NULL,claim_token=NULL,claimed_at=NULL,updated_at=?,finished_at=? WHERE id=? AND agent_id=? AND status IN ('active','checking')",params:[now,now,opts.triggerId,opts.id]});ctx.fns.agent.wakeWorker({});return{cancelled:r.changes>0};
}
