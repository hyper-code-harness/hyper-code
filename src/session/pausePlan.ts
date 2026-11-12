/**
 * Pause the agent's plan: stops automatic plan continuation and freezes the active task's clock until a new user
 * run, session.done or a retry resumes it. Use when the person presses Stop (reason "user") or when agent.run
 * spends its continuation budget without the task being closed (reason "limit"); the reason is shown in the plan panel.
 * Returns paused:false when there is no plan or it is already paused.
 * @param opts.agent Live agent whose plan is paused.
 * @param opts.reason Why it is paused: "user" (Stop pressed) or "limit" (continuation budget spent). @default "user"
 * @param opts.note Short human-readable explanation stored on the plan as pauseNote.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live agent whose plan is paused. */
        agent?: types.agent.Agent;
        /** Why it is paused: "user" (Stop pressed) or "limit" (continuation budget spent). @default "user" */
        reason?: "user" | "limit";
        /** Short human-readable explanation stored on the plan as pauseNote. */
        note?: string;
    },
): Promise<{ paused: boolean; remaining: Array<{ id: string; title: string; status: string }> }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("pausePlan: agent is required");
    const reason = opts.reason ?? "user";
    const note = String(opts.note ?? "").trim().slice(0, 500);
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, ts: number) => {
        const plan = scratchpad.plan;
        if (!plan || plan.pausedAt) return { paused: false, remaining: [] };
        const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
        const task = tasks.find((item: any) => item.status === "active");
        if (task?.activeSince) {
            task.elapsedMs = Math.max(0, Number(task.elapsedMs ?? 0)) + Math.max(0, ts - Number(task.activeSince));
            task.activeSince = null;
        }
        plan.pausedAt = ts;
        plan.pauseReason = reason;
        plan.pauseNote = note || null;
        plan.updatedAt = ts;
        const remaining = tasks.filter((item: any) => item.status !== "done")
            .map((item: any) => ({ id: String(item.id), title: String(item.title ?? ""), status: String(item.status) }));
        return { paused: true, remaining };
    } });
    agent.scratchpad = updated.scratchpad;
    if (updated.result.paused) ctx.fns.events?.refreshAgentMeta?.({ agentId: agent.id, section: "plan", reason: "plan-paused" });
    return updated.result;
}
