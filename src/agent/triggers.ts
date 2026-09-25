/**
 * Lists durable triggers belonging to an agent
 *
 * List one agent’s time, cron and condition triggers with their lifecycle state and next check time. Use to inspect pending, completed, timed-out or cancelled triggers.
 * @param opts.id Agent identifier.
 * @param opts.status Lifecycle filter. @default active
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** Lifecycle filter. @default active */
        status?: "active" | "completed" | "timed_out" | "cancelled" | "all";
    },
): Promise<any[]> {
    const status = opts.status ?? "active";
    const params: any[] = [opts.id];
    let where = "t.agent_id=?";
    if (status !== "all") { where += " AND t.status=?"; params.push(status); }
    return await ctx.fns.procs.db.select({
        sql: `SELECT t.id,t.kind,t.prompt,t.config,t.timezone,t.mode,t.status,
                     t.next_at AS "nextAt",t.timeout_at AS "timeoutAt",t.last_ready AS "lastReady",
                     t.attempts,t.last_error AS "lastError",t.created_at AS "createdAt",t.finished_at AS "finishedAt",
                     r.outcome AS "lastOutcome",r.result AS "lastResult",r.error AS "lastRunError",
                     r.scheduled_at AS "lastScheduledAt",r.created_at AS "lastRunAt"
                FROM agent_triggers t
                LEFT JOIN LATERAL (
                    SELECT outcome,result,error,scheduled_at,created_at
                      FROM agent_trigger_runs WHERE trigger_id=t.id ORDER BY id DESC LIMIT 1
                ) r ON TRUE
               WHERE ${where} ORDER BY t.created_at DESC`,
        params,
    }) as any[];
}
