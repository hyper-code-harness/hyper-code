/**
 * Claim one due conversation turn only when no compaction is queued or active
 *
 * Worker-internal queue claim. Locks the agent row, then rereads maintenance jobs using a fresh statement so a concurrent compaction enqueue cannot be missed. Never consumes messages or changes a schedule until the turn is successfully claimed.
 * @param opts.now Current epoch milliseconds for due-time selection and the renewable run lease.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Current epoch milliseconds for due-time selection and the renewable run lease. */
        now: number;
    },
): Promise<{ id: string; token: string } | null> {
    return await ctx.fns.procs.db.transaction({ fn: async () => {
        const rows = await ctx.fns.procs.db.select({ sql:         "SELECT id FROM agents a WHERE run_state='idle' AND run_token IS NULL AND next_run_at <= ? AND archived_at IS NULL AND sleep_context->>'draftRevision' IS NULL AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.agent_id=a.id AND j.runner='compaction' AND j.status='running') ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED", params: [opts.now] });
        if (!rows.length) return null;
        const id = String(rows[0].id);
        const pending = await ctx.fns.procs.db.select({ sql: "SELECT id FROM jobs WHERE agent_id=? AND runner='compaction' AND status='running'", params: [id] });
        if (pending.length) return null;
        const token = crypto.randomUUID();
        const claimed = await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state='running',run_started_at=?,run_heartbeat_at=?,run_token=?,next_run_at=NULL,last_error=NULL,updated_at=? WHERE id=? AND run_state='idle' AND run_token IS NULL AND archived_at IS NULL AND next_run_at <= ? AND sleep_context->>'draftRevision' IS NULL", params: [opts.now,opts.now,token,opts.now,id,opts.now] });
        return claimed.changes ? { id, token } : null;
    } }) as { id: string; token: string } | null;
}
