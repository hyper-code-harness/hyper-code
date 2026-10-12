/**
 * Lists durable external event attachments for an agent
 *
 * Inspect active, paused, or detached external event subscriptions belonging to one agent.
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
        status?: "active" | "paused" | "detached" | "all";
    },
): Promise<any[]> {
    const status=opts.status??"active",params:any[]=[opts.id];let where="agent_id=?";if(status!=="all"){where+=" AND status=?";params.push(status);}return await ctx.fns.procs.db.select({sql:`SELECT id,source,events,filter,prompt,status,created_at AS "createdAt",updated_at AS "updatedAt",detached_at AS "detachedAt" FROM agent_attachments WHERE ${where} ORDER BY created_at DESC`,params}) as any[];
}
