/**
 * Lease one queued compaction whose agent is idle without claiming a conversation turn
 *
 * Worker-internal maintenance claim. Locks the same agent row as turn claims and enqueue, then takes a fresh job-row lock. Pending requests survive restarts and expired leases are retried at most three times. Does not modify next_run_at, run_state or the user-message cursor.
 * @param opts.now Current epoch milliseconds for scheduling and lease expiry.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Current epoch milliseconds for scheduling and lease expiry. */
        now: number;
    },
): Promise<{ agentId: string; jobId: string; token: string } | null> {
    // Finish interrupted cancellation even when the original caller crashed
    // between recording cancel_requested_at and jobs.finish. No inbox message.
    await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET status='cancelled',outcome_reason='cancelled',finished_at=?,updated_at=?,next_at=NULL,lease_token=NULL,lease_expires_at=NULL WHERE runner='compaction' AND status='running' AND cancel_requested_at IS NOT NULL", params:[opts.now,opts.now] });
    return await ctx.fns.procs.db.transaction({ fn: async () => {
        const rows = await ctx.fns.procs.db.select({ sql: "SELECT a.id FROM agents a WHERE a.archived_at IS NULL AND a.run_state='idle' AND a.run_token IS NULL AND a.sleep_context->>'draftRevision' IS NULL AND NOT EXISTS (SELECT 1 FROM jobs busy WHERE busy.agent_id=a.id AND busy.runner='compaction' AND busy.status='running' AND busy.lease_expires_at > ?) AND EXISTS (SELECT 1 FROM jobs j WHERE j.agent_id=a.id AND j.runner='compaction' AND j.status='running' AND j.cancel_requested_at IS NULL AND j.next_at <= ? AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= ?)) ORDER BY a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED", params: [opts.now,opts.now,opts.now] });
        if (!rows.length) return null;
        const agentId = String(rows[0].id);
        // Re-read after the agent lock: another claimant may have won while we waited.
        const busy = await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE agent_id=? AND runner='compaction' AND status='running' AND lease_expires_at>?", params:[agentId,opts.now] });
        if (busy.length) return null;
        const job = (await ctx.fns.procs.db.select({ sql: "SELECT id,state FROM jobs WHERE agent_id=? AND runner='compaction' AND status='running' AND cancel_requested_at IS NULL AND next_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?) ORDER BY created_at LIMIT 1 FOR UPDATE", params: [agentId,opts.now,opts.now] }))[0];
        if (!job) return null;
        const state = typeof job.state === "string" ? JSON.parse(job.state) : job.state ?? {};
        const attempts = Number(state.attempts ?? 0);
        if (attempts >= 3) {
            await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET status='failed',outcome_reason='compaction_retry_limit',finished_at=?,next_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?", params:[opts.now,opts.now,job.id] });
            return null;
        }
        const token = crypto.randomUUID();
        await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET lease_token=?,lease_expires_at=?,next_at=?,started_at=COALESCE(started_at,?),state=?::jsonb,updated_at=? WHERE id=?", params: [token,opts.now+120_000,opts.now+120_000,opts.now,JSON.stringify({...state,attempts:attempts+1}),opts.now,job.id] });
        return { agentId, jobId:String(job.id), token };
    } }) as { agentId: string; jobId: string; token: string } | null;
}
