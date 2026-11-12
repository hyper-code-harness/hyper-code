/**
 * Pause the agent's plan: automatic plan continuation stops and the active task's clock freezes until the plan is
 * resumed (a new message from the person, session.done, session.resumePlan or a retry). Call it yourself, with a
 * reason, as the explicit decision to stop working on an unfinished plan task: only when nothing more can be done
 * without the person or an external event (an answer, an approval, a background job, a blocker you cannot remove).
 * Never pause because the work is long, hard or uncertain, or to end a turn early — a text reply without
 * session.done or session.pausePlan is answered with a reminder to keep working. The reason and the remaining
 * steps are shown in the chat and in the plan panel. Returns paused:false when there is no plan or it is already paused.
 * @param opts.agent Live agent whose plan is paused.
 * @param opts.reason What the plan is waiting for, in one sentence the person will read. Required when by is "agent".
 * @param opts.by Who paused it: "agent" (your explicit decision), "user" (Stop pressed) or "limit" (the run hit its cycle cap). @default "agent"
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live agent whose plan is paused. */
        agent?: types.agent.Agent;
        /** What the plan is waiting for, in one sentence the person will read. Required when by is "agent". */
        reason?: string;
        /** Who paused it: "agent" (your explicit decision), "user" (Stop pressed) or "limit" (the run hit its cycle cap). @default "agent" */
        by?: "agent" | "user" | "limit";
    },
): Promise<{ paused: boolean; remaining: Array<{ id: string; title: string; status: string }> }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("pausePlan: agent is required");
    const by = opts.by ?? "agent";
    if (!["agent", "user", "limit"].includes(by)) throw new Error(`pausePlan: unknown by "${by}"`);
    const reason = String(opts.reason ?? "").trim().slice(0, 500);
    if (by === "agent" && !reason) throw new Error("pausePlan: reason is required — say what the plan is waiting for");
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, ts: number) => {
        const plan = scratchpad.plan;
        if (!plan || plan.pausedAt) return { paused: false, remaining: [], activeTaskId: null };
        const tasks = Array.isArray(plan.tasks) ? plan.tasks : [];
        const task = tasks.find((item: any) => item.status === "active");
        if (task?.activeSince) {
            task.elapsedMs = Math.max(0, Number(task.elapsedMs ?? 0)) + Math.max(0, ts - Number(task.activeSince));
            task.activeSince = null;
        }
        plan.pausedAt = ts;
        plan.pausedBy = by;
        plan.pauseReason = reason || null;
        plan.updatedAt = ts;
        const remaining = tasks.filter((item: any) => item.status !== "done")
            .map((item: any) => ({ id: String(item.id), title: String(item.title ?? ""), status: String(item.status) }));
        return { paused: true, remaining, activeTaskId: task ? String(task.id) : null };
    } });
    agent.scratchpad = updated.scratchpad;
    const { paused, remaining, activeTaskId } = updated.result;
    if (!paused) return { paused: false, remaining: [] };
    // Stop writes its own "stopped by user" line; every other pause says in the chat why work ended and what is left.
    if (by !== "user") {
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "plan_paused", by, reason, activeTaskId, remaining } });
        await ctx.fns.session.syncAgentState({ agent });
    }
    ctx.fns.events?.refreshAgentMeta?.({ agentId: agent.id, section: "plan", reason: "plan-paused" });
    return { paused, remaining };
}
