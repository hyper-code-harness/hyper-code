/**
 * Archive completed delegated agents after an inactivity timeout
 *
 * Archives ready delegated children only after inactivity and only when they have no running turn, queued run, unread user message or running job (including watches, schedules and subscriptions). Completion metadata alone is not evidence that a child is idle. The archive UPDATE rechecks these conditions; automatic cleanup never cancels background work. Transcripts remain durable for later unarchive.
 * @param opts.olderThanMs Minimum inactivity age for a ready delegated child before archival. @default 60000 @minimum 0
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Minimum inactivity age for a ready delegated child before archival. @default 60000 @minimum 0 */
        olderThanMs?: number;
    },
): Promise<{ archived: string[] }> {
    const olderThanMs = Math.max(0, Number(opts.olderThanMs ?? 60000));
    const cutoff = Date.now() - olderThanMs;
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT id, parent_id FROM agents WHERE archived_at IS NULL AND parent_id IS NOT NULL
              AND updated_at <= ? AND scratchpad::jsonb #>> '{delegation,status}' = 'ready'
              AND run_state = 'idle' AND run_token IS NULL AND next_run_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.agent_id = agents.id
                  AND m.role = 'user' AND m.excluded_from_cursor = 0 AND m.idx > agents.last_processed_msg_idx)
              AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.agent_id = agents.id AND j.status = 'running')`,
        params: [cutoff],
    });
    const archived: string[] = [];
    for (const row of rows) {
      const result = await ctx.fns.session.archive({ id: String(row.id), autoBefore: cutoff });
      if (!result.ok) continue;
      archived.push(String(row.id));
      ctx.fns.events.refreshAgentMeta({ agentId: String(row.parent_id), section: "team", reason: "team-timeout-archive" });
    }
    return { archived };
}
