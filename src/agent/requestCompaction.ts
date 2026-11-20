/**
 * Queue a durable context-compaction request without interrupting the agent
 *
 * Use from manual compaction controls, including while a turn is running. Stores focus instructions in the jobs queue. Repeated requests update the waiting request; an already executing compaction gets one follow-up request. Does not append a user message, alter the message cursor or schedule a conversation turn.
 * @param opts.agentId Unarchived agent whose context should be compacted between turns.
 * @param opts.instructions Optional focus instructions for the summarizer; blank uses its standard handoff rules.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unarchived agent whose context should be compacted between turns. */
        agentId: string;
        /** Optional focus instructions for the summarizer; blank uses its standard handoff rules. */
        instructions?: string;
    },
): Promise<{ status: "queued"; jobId: string; reused: boolean }> {
    const state = ctx.state as typeof ctx.state & { workerLoopPromise?: Promise<unknown>; compactionQueueWorker?: boolean };
    // A hot-loaded function cannot replace the lexical body of a running old
    // worker. Refuse enqueue only during that one-time maintenance transition.
    if (state.workerLoopPromise && state.compactionQueueWorker !== true) throw new Error("Compaction queue is being activated; please retry after the worker reload finishes");
    const now = Date.now();
    const instructions = opts.instructions?.trim() || "";
    const result = await ctx.fns.procs.db.transaction({ fn: async () => {
        const owner = (await ctx.fns.procs.db.select({ sql: "SELECT id,created_by FROM agents WHERE id=? AND archived_at IS NULL FOR UPDATE", params: [opts.agentId] }))[0];
        if (!owner) throw new Error("agent not found");
        const pending = (await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE agent_id=? AND runner='compaction' AND status='running' AND lease_token IS NULL AND cancel_requested_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE", params: [opts.agentId] }))[0];
        const jobId = pending ? String(pending.id) : "cmp_" + Bun.randomUUIDv7();
        const spec = JSON.stringify({ title: "Compact context", instructions });
        if (pending) await ctx.fns.procs.db.run({ sql: "UPDATE jobs SET spec=?::jsonb,next_at=?,updated_at=? WHERE id=?", params: [spec, now, now, jobId] });
        else await ctx.fns.procs.db.run({ sql: "INSERT INTO jobs (id,kind,runner,spec,state,status,owner_id,created_by,agent_id,execution_id,next_at,created_at,updated_at) VALUES (?,'exec','compaction',?::jsonb,'{}'::jsonb,'running',?,?,?,?,?,?,?)", params: [jobId,spec,owner.created_by ?? null,session?.user?.id ?? (session?.agentId ? "agent:" + session.agentId : null),opts.agentId,jobId,now,now,now] });
        return { status: "queued" as const, jobId, reused: !!pending };
    } }) as { status: "queued"; jobId: string; reused: boolean };
    await ctx.fns.session.appendEventWithHtml({ id: opts.agentId, type: "compaction_queued", payload: { jobId: result.jobId, reused: result.reused } });
    ctx.fns.events.refreshAgentMeta({ agentId: opts.agentId, section: "automation", reason: "compaction-queued" });
    ctx.fns.agent.wakeWorker({});
    return result;
}
