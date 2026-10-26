/**
 * Describes the agent's longest-running live tool call as a running w.toolGroup cell, or null when nothing runs.
 *
 * Use to append the call in progress to the chat's last tool row; the cell opens agent.activeToolDetails, and
 * startedAt feeds the row's ticking clock (w.toolGroup runningSince).
 * @param opts.agentId Agent whose running tool call is described.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose running tool call is described. */
    agentId: string;
}): { icon: string; title: string; running: true; startedAt: number; action: types.w.Action } | null {
    // Longest-running first: that is the call a waiting user is blocked on.
    const run = ctx.fns.tools.runs({ agentId: opts.agentId })[0];
    if (!run) return null;
    const label = `${run.name} ${run.subject}`.trim();
    return {
        icon: String(run.icon).replace(/^ph-/, ""),
        title: `${label} — running, click for details`,
        running: true,
        startedAt: Number(run.startedAt),
        action: { popup: { method: "agent.activeToolDetails", params: { agentId: opts.agentId } } },
    };
}
