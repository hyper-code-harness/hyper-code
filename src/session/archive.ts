/**
 * Archive a session, optionally requiring an inactive completed delegated child.
 *
 * Explicit archival cancels the agent's jobs. Automatic team cleanup must pass
 * autoBefore: the final UPDATE rechecks completion, inactivity, the run queue,
 * unread user messages and every running job before changing the row. Automatic
 * cleanup never cancels jobs; it can only archive a child with no work to retain.
 * @param opts.id Agent identifier.
 * @param opts.autoBefore Automatic cleanup only: archive an idle ready child last updated at or before this epoch-millisecond cutoff; omit for explicit archival.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent identifier. */
    id: string;
    /** Automatic cleanup cutoff in epoch milliseconds; omit to explicitly archive and cancel jobs. @minimum 0 */
    autoBefore?: number;
}): Promise<{ ok: boolean }> {
    const { id } = opts;
    if (opts.autoBefore !== undefined && (!Number.isFinite(opts.autoBefore) || opts.autoBefore < 0)) throw new Error("archive: autoBefore must be a nonnegative timestamp");
    const automatic = opts.autoBefore !== undefined;
    const res = await ctx.fns.procs.db.run(automatic ? {
        sql: `UPDATE agents SET archived_at = ? WHERE id = ?
              AND archived_at IS NULL AND parent_id IS NOT NULL AND updated_at <= ?
              AND scratchpad::jsonb #>> '{delegation,status}' = 'ready'
              AND run_state = 'idle' AND run_token IS NULL AND next_run_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.agent_id = agents.id
                  AND m.role = 'user' AND m.excluded_from_cursor = 0 AND m.idx > agents.last_processed_msg_idx)
              AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.agent_id = agents.id AND j.status = 'running')`,
        params: [Date.now(), id, opts.autoBefore],
    } : { sql: 'UPDATE agents SET archived_at = ? WHERE id = ?', params: [Date.now(), id] });
    const ok = res.changes > 0;
    // Explicit archival cancels jobs (unarchive does not restore them). Automatic
    // cleanup has proved there are none: never run a broad cancellation after that
    // check, which could kill work submitted concurrently with cleanup.
    if (ok && !automatic) await ctx.fns.jobs.cancelAgent({ agentId: id }).catch((error: any) => console.error(`archive: cancelling jobs of ${id} failed:`, error?.message ?? error));
    if (ok) await ctx.fns.events.emitAgentsChanged({ agentId: id, reason: 'archive' });
    return { ok };
}
