/**
 * Execute a leased compaction job without running or waking the conversation
 *
 * Worker-internal maintenance executor. Renews only the jobs lease, passes stored focus instructions to the compactor, records completion without a user message, and retries stale projections up to the bounded claim limit. Activation and success are atomic inside compactContext; revoked attempts cannot finalize a newer lease.
 * @param opts.agentId Idle agent owning the claimed maintenance job.
 * @param opts.jobId Compaction job previously claimed with claimCompaction.
 * @param opts.token Opaque lease token returned by the claim.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Idle agent owning the claimed maintenance job. */
        agentId: string;
        /** Compaction job previously claimed with claimCompaction. */
        jobId: string;
        /** Opaque lease token returned by the claim. */
        token: string;
    },
): Promise<void> {
    const ac = new AbortController();
    let beating = false;
    const beat = async () => {
        if (beating) return;
        beating = true;
        try {
            const now = Date.now();
            const changed = await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET lease_expires_at=?,next_at=?,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL", params: [now+120_000,now+120_000,now,opts.jobId,opts.token,now] });
            if (!changed.changes) ac.abort("compaction lease revoked");
        } finally { beating = false; }
    };
    const timer = setInterval(() => { void beat().catch(error => { ac.abort(error); }); }, 20_000);
    const finish = async (status: "succeeded" | "failed", reason: string, error?: string) => {
        const now = Date.now();
        return await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET status=?,outcome_reason=?,result=?::jsonb,finished_at=?,updated_at=?,next_at=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL", params: [status,reason,JSON.stringify({ tail:error ?? reason }),now,now,opts.jobId,opts.token,now] });
    };
    try {
        const job = (await ctx.fns.procs.db.select({ sql: "SELECT spec FROM jobs WHERE id=? AND agent_id=? AND runner='compaction' AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL", params:[opts.jobId,opts.agentId,opts.token,Date.now()] }))[0];
        if (!job) return;
        const agent = ctx.state.agent?.[opts.agentId] ?? await ctx.fns.session.load({ id: opts.agentId });
        if (!agent) { await finish("failed","agent_not_found"); return; }
        const spec = typeof job.spec === "string" ? JSON.parse(job.spec) : job.spec;
        const result = await ctx.fns.agent.compactContext({ agent, instructions:spec.instructions || undefined, job:{id:opts.jobId,token:opts.token}, signal:ac.signal });
        if (result.status === "stale") {
            const now = Date.now();
            await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET next_at=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at>? AND cancel_requested_at IS NULL", params:[now+250,now,opts.jobId,opts.token,now] });
        } else if (result.status === "not_needed") {
            const changed = await finish("succeeded","not_needed");
            if (changed.changes) await ctx.fns.session.appendEventWithHtml({ id:opts.agentId,type:"compaction_not_needed",payload:{jobId:opts.jobId} });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const changed = await finish("failed","compaction_failed",message);
        if (changed.changes) await ctx.fns.session.appendEventWithHtml({ id:opts.agentId,type:"compaction_job_failed",payload:{jobId:opts.jobId,error:message} });
    } finally {
        clearInterval(timer);
        ctx.fns.events.refreshAgentMeta({ agentId:opts.agentId,section:"automation",reason:"compaction-job" });
        ctx.fns.agent.wakeWorker({});
    }
}
