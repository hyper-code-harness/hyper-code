/**
 * Draws the goal button of a chat's message box: a target icon that opens the goal editor.
 *
 * Use in the composer meters, beside the subagents and background-jobs badges. Always returns the target icon button, so a goal can be set from the same place: grey while the chat has no goal or the goal is off (paused, reached, stopped by the checker), blue while the goal is active (colour only, no background). The tooltip says the state and the goal; a click opens agent.goalPopup. Returns an empty string only when the chat does not exist or the viewer may not see it.
 * @param opts.agentId Chat whose goal is drawn.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Chat whose goal is drawn. */
        agentId: string;
    },
): Promise<string> {
    const agentId = String(opts.agentId ?? "");
        if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return "";
        const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
        if (!agent) return "";
        const goal: any = agent.goal;
        const statement = String(goal?.statement ?? "").trim();
        const edit = { popup: { method: "agent.goalPopup", params: { agentId } } };
        // Always there, so a goal can be set from the same place: grey while the chat has no goal.
        if (!statement) return ctx.fns.w.iconButton({ icon: "target", label: "No goal — click to set one", action: edit, marks: { action: "goal", entity: "agent", id: agentId, status: "none" } });
        const status = String(goal.status ?? "active");
        // Running: the checker will hold the agent to it — the only state drawn in colour. Otherwise grey, and the
        // tooltip says why it is off: paused by the person, reached, or the checker's last verdict.
        const state = goal.enabled ? "active" : status === "achieved" ? "reached" : status === "active" ? "paused" : status.replace(/_/g, " ");
        const short = statement.length > 140 ? statement.slice(0, 139) + "…" : statement;
        return ctx.fns.w.iconButton({
            icon: "target",
            label: `Goal ${state}: ${short} — click to edit`,
            tone: goal.enabled ? "info" : undefined,
            action: edit,
            marks: { action: "goal", entity: "agent", id: agentId, status: state.replace(/ /g, "-") },
        });
}
