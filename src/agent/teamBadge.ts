/**
 * Draws the chat input's subagents badge: a robot icon with the number of the chat's delegated children still working.
 *
 * Shown in the chat input next to the background-jobs badge while at least one direct team child (agent.delegate) has
 * not finished; empty otherwise or when the signed-in person may not see this chat (jobs.canSee). A click opens
 * agent.teamPopup with the list, progress and Stop. Re-fetched by its live region (GET /agent/:id/team-badge) when
 * the team changes (events.refreshAgentMeta with section team signals the parent's topic).
 * @param opts.agentId Parent agent (chat) whose subagents are counted.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Parent agent (chat) whose subagents are counted. */
    agentId: string;
}): Promise<string> {
    const agentId = String(opts.agentId ?? "");
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return "";
    const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
    if (!agent) return "";
    const team = await ctx.fns.agent.team({ agent });
    const n = team.filter((m) => m.status === "working" || m.runState === "running").length;
    if (!n) return "";
    const label = `${n} subagent${n === 1 ? "" : "s"} working`;
    return ctx.fns.w.iconButton({
        icon: "robot",
        label: `${label} — click to see or stop`,
        badge: n,
        action: { popup: { method: "agent.teamPopup", params: { agentId } } },
        marks: { action: "team", entity: "agent", id: agentId },
    });
}
