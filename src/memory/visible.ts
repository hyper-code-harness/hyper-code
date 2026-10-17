/**
 * Returns the visibility filter of the `memory` table for whoever is calling: an agent or a signed-in person.
 *
 * Use in functions that read memory and may be called both by an agent (through ctx.fns) and by a person in the
 * browser (a `@view` page at `GET /rpc/<fn>`). An agent sees its four levels (memory.scope). A person sees system
 * memory, their own user level, every project (signed-in people of the instance share projects) and the agent
 * level of the agents they created; the instance owner also sees agents without a creator.
 * @param opts.agentId Read as this agent instead of the session's caller.
 * @param opts.userId Read as this person instead of the session's caller.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Read as this agent instead of the session's caller. */
    agentId?: string;
    /** Read as this person instead of the session's caller. */
    userId?: string;
}): Promise<{ as: "agent" | "user"; id: string; sql: string; params: Array<string | null>; order: string }> {
    const order = "case visibility when 'agent' then 0 when 'project' then 1 when 'user' then 2 else 3 end";
    const agentId = opts.agentId ?? (opts.userId ? undefined : (session as any)?.agentId);
    if (agentId) {
        const s = await ctx.fns.memory.scope({ agentId });
        return { as: "agent", id: agentId, sql: s.visibleSql, params: s.visibleParams, order: s.order };
    }
    const userId = opts.userId ?? (session as any)?.user?.id;
    if (!userId) throw new Error("memory.visible: no agent or signed-in person in this call");
    const rows: any[] = await ctx.fns.procs.db.select({ sql: "select role from users where id = ?", params: [userId] });
    const owner = rows[0]?.role === "owner";
    const mine = owner
        ? "(select id from agents where created_by = ? or created_by is null)"
        : "(select id from agents where created_by = ?)";
    return {
        as: "user", id: userId,
        sql: `(visibility = 'system' or (visibility = 'user' and user_id = ?) or visibility = 'project' or (visibility = 'agent' and agent_id in ${mine}))`,
        params: [userId, userId],
        order,
    };
}
