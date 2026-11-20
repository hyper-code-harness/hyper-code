/**
 * Draws the plan of a chat in its message box as one small element: the count of finished tasks ("2/4") that opens the to-do list.
 *
 * Use in the composer meters, beside the goal, subagents and background-jobs badges. With a plan (session.plan) it
 * is a count pill — blue while a task is being worked on, grey when the plan is paused, green when every task is
 * done; the tooltip names the plan and the current task. Without a plan it is a quiet list icon that opens an empty
 * list to write tasks into. A click opens agent.planPopup.
 * @param opts.agentId Chat whose plan is drawn.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Chat whose plan is drawn. */
        agentId: string;
    },
): Promise<string> {
    const agentId = String(opts.agentId ?? "");
        if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return "";
        const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
        const plan: any = agent?.scratchpad?.plan;
        const tasks: any[] = Array.isArray(plan?.tasks) ? plan.tasks : [];
        const open = { popup: { method: "agent.planPopup", params: { agentId } } };
        if (!agent) return "";
        if (!tasks.length) return ctx.fns.w.iconButton({ icon: "list-checks", label: "No plan — click to add tasks", action: open, marks: { action: "plan", entity: "agent", id: agentId, status: "none" } });
        const done = tasks.filter(t => t.status === "done").length;
        const active = tasks.find(t => t.status === "active");
        const state = done === tasks.length ? "done" : plan.pausedAt ? "paused" : active ? "working" : "waiting";
        const what = state === "done" ? "all done" : state === "paused" ? `paused at: ${active?.title ?? tasks.find(t => t.status !== "done")?.title ?? ""}` : `now: ${active?.title ?? tasks.find(t => t.status !== "done")?.title ?? ""}`;
        const name = String(plan.title || "Plan");
        return ctx.fns.w.badge({
            text: `${done}/${tasks.length}`,
            tone: state === "done" ? "success" : state === "working" ? "info" : "neutral",
            action: open,
            title: `${name} · ${done} of ${tasks.length} tasks done · ${what.length > 120 ? what.slice(0, 119) + "…" : what} — click to open`,
            marks: { action: "plan", entity: "agent", id: agentId, status: state },
        });
}
