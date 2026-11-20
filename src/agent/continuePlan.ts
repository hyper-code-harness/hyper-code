/**
 * Tells an idle agent to work on its plan's current task now.
 *
 * Use when a person presses Start or Continue on a plan that is waiting (the plan popup, agent.planPopup): after tasks were added or ticked by hand while the agent was idle, or after Stop paused the plan. It resumes the plan, makes the first queued task current when none is, queues the same 'Continue the active plan task' message the plan editor sends and wakes the worker. Fails when the chat has no plan or every task is done.
 * @param opts.agent Agent that owns the plan; defaults to the current session agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent that owns the plan; defaults to the current session agent. */
        agent?: types.agent.Agent;
    },
): Promise<{ ok: true; task: { id: string; title: string } }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("continuePlan: agent is required");
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
        const plan = scratchpad.plan;
        if (!plan || !Array.isArray(plan.tasks)) throw new Error("continuePlan: this chat has no plan");
        let active = plan.tasks.find((task: any) => task.status === "active");
        if (!active) {
            active = plan.tasks.find((task: any) => task.status === "pending");
            if (!active) throw new Error("continuePlan: every task is done");
            active.status = "active";
        }
        active.startedAt ??= now;
        active.activeSince ??= now;
        plan.pausedAt = null;
        plan.updatedAt = now;
        return { id: String(active.id), title: String(active.title ?? ""), instructions: String(active.instructions ?? "") };
    } });
    agent.scratchpad = updated.scratchpad;
    const task: { id: string; title: string; instructions: string } = updated.result;
    // The same instruction the plan editor sends on Save: an ordinary queued user message, so an idle agent wakes up.
    const text = [
        "Continue the active plan task.",
        "Task ID: " + task.id,
        "Title: " + task.title,
        task.instructions ? "Instructions:\n" + task.instructions : "",
        "Call session.done({ agent, id: " + JSON.stringify(task.id) + " }) only after the task is complete.",
    ].filter(Boolean).join("\n\n");
    const message = await ctx.fns.session.appendMessage({ id: agent.id, message: { role: "user", content: text, message_type: "plan_activation" } as any });
    await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "plan_activation", taskId: task.id, title: task.title, instructions: task.instructions, messageIdx: message.idx } as any });
    await ctx.fns.session.syncAgentState({ agent });
    const now = Date.now();
    // Now, even when a later run is already scheduled (a debounce window, a wake set for tomorrow): the person pressed Start.
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = LEAST(COALESCE(next_run_at, ?), ?), updated_at = ? WHERE id = ?", params: [now, now, now, agent.id] });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: agent.id, section: "plan", reason: "plan-continue" });
    return { ok: true, task: { id: task.id, title: task.title } };
}
