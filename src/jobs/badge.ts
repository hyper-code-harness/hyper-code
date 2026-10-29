/**
 * Draws the chat input's background-jobs badge: an icon with the number of the chat's background commands running.
 *
 * Shown in the chat input before the context ring while at least one bash/eval job of the chat runs (also after the agent's turn has
 * ended); empty otherwise. A click opens jobs.popup with the list, the logs and Stop. Re-fetched by its live region
 * (GET /jobs/:id/badge) when a job starts or ends.
 * @param opts.agentId Agent (chat) whose jobs are counted.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent (chat) whose jobs are counted. */
    agentId: string;
}): Promise<string> {
    const agentId = String(opts.agentId ?? "");
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return "";
    const rows = await ctx.fns.procs.db.select({
        sql: "SELECT count(*)::int AS n, min(started_at) AS since FROM jobs WHERE agent_id = ? AND kind = 'exec' AND status = 'running'",
        params: [agentId],
    }) as Array<{ n: number; since: number | null }>;
    const n = Number(rows[0]?.n ?? 0);
    if (!n) return "";
    const label = `${n} job${n === 1 ? "" : "s"}`;
    // An icon with the count as an unread-style mark in its corner, like the other icon buttons.
    return ctx.fns.w.iconButton({
        icon: "hourglass-medium",
        label: `${label} running in the background — click to see or stop`,
        badge: n,
        action: { popup: { method: "jobs.popup", params: { agentId } } },
        marks: { action: "jobs", entity: "agent", id: agentId },
    });
}
