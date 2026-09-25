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
    const status=opts.status??"active";const params:any[]=[opts.id];let where="agent_id=?";if(status!=="all"){where+=" AND status=?";params.push(status);}return await ctx.fns.procs.db.select({sql:`SELECT id,kind,prompt,config,timezone,mode,status,next_at AS "nextAt",timeout_at AS "timeoutAt",last_ready AS "lastReady",attempts,last_error AS "lastError",created_at AS "createdAt",finished_at AS "finishedAt" FROM agent_triggers WHERE ${where} ORDER BY created_at DESC`,params}) as any[];
}
