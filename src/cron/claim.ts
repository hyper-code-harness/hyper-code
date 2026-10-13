/**
 * Atomically claims one due enabled cron task and creates its run row.
 * @param opts.now Timestamp used to select due work.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Timestamp used to select due work. */ now?: number;
}): Promise<any | null> {
    const now = Math.floor(opts.now ?? Date.now());
    const rows = await ctx.fns.procs.db.select({
        sql: `WITH due AS (
                SELECT name FROM cron_tasks
                 WHERE enabled AND state='idle' AND next_run_at IS NOT NULL AND next_run_at <= ?
                 ORDER BY next_run_at, name LIMIT 1 FOR UPDATE SKIP LOCKED
              ), claimed AS (
                UPDATE cron_tasks t SET state='running', updated_at=? FROM due WHERE t.name=due.name
                RETURNING t.name, t.fn, t.args, t.next_run_at, t.authority_version
              )
              INSERT INTO cron_runs (task_name, fn, args, scheduled_at, started_at, status, created_at, authority_version)
              SELECT name, fn, args, next_run_at, ?, 'running', ?, authority_version FROM claimed
              RETURNING id, task_name AS name, fn, args, scheduled_at AS "scheduledAt", started_at AS "startedAt"`,
        params: [now, now, now, now],
    });
    return rows[0] ?? null;
}
