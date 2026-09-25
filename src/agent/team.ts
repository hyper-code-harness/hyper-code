/**
 * List delegated child agents and their existing task plans
 *
 * Returns the durable read-only Team projection for a parent agent, including each direct child plan, delegation status, and last summary. Use to render team progress or inspect delegated work without loading child transcripts.
 * @param opts.includeArchived Whether to return archived direct children instead of active children. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Parent agent whose direct delegated children are listed. */
        agent: types.agent.Agent;
        /** Whether to return archived direct children instead of active children. @default false */
        includeArchived?: boolean;
    },
): Promise<Array<{ id: string; title: string; runState: string; status: string; plan: any; summary: string | null; updatedAt: number; archivedAt: number | null }>> {
    const archivedClause = opts.includeArchived ? "archived_at IS NOT NULL" : "archived_at IS NULL";
    const rows = (await ctx.fns.procs.db.select({ sql: `SELECT id, title, run_state, scratchpad, updated_at, archived_at FROM agents WHERE parent_id = ? AND visibility = 'team' AND ${archivedClause} ORDER BY created_at ASC`, params: [opts.agent.id] })) as any[];
    const members: Array<{ id: string; title: string; runState: string; status: string; plan: any; summary: string | null; updatedAt: number; archivedAt: number | null }> = [];
    for (const row of rows) {
      const scratchpad = typeof row.scratchpad === "string" ? JSON.parse(row.scratchpad) : (row.scratchpad ?? {});
      const delegation = scratchpad.delegation ?? scratchpad.delegateTask ?? {};
      const allDone = Array.isArray(scratchpad.plan?.tasks) && scratchpad.plan.tasks.length > 0 && scratchpad.plan.tasks.every((task: any) => task.status === "done");
      members.push({ id: String(row.id), title: String(row.title ?? ""), runState: String(row.run_state ?? "idle"), status: String(delegation.status ?? (allDone ? "ready" : "working")), plan: scratchpad.plan ?? null, summary: delegation.summary ?? delegation.result?.summary ?? null, updatedAt: Number(row.updated_at ?? 0), archivedAt: row.archived_at == null ? null : Number(row.archived_at) });
    }
    return members;
}
