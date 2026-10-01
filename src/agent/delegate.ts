/**
 * Delegate a visible multi-step plan to a resumable child agent
 *
 * Forks the parent session, assigns the child the same task-list format used by session.plan, starts it asynchronously, and returns an addressable team member. Use for independent work whose tool traffic should stay out of the parent context.
 * @param opts.agent Parent agent delegating the work.
 * @param opts.title Short title shown for the child and its plan.
 * @param opts.tasks Ordered tasks in the native session.plan format; IDs must be stable and unique.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Parent agent delegating the work. */
        agent: types.agent.Agent;
        /** Short title shown for the child and its plan. */
        title: string;
        /** Ordered tasks in the native session.plan format; IDs must be stable and unique. */
        tasks: Array<{ id: string; title: string; instructions?: string }>;
    },
): Promise<{ id: string; status: "working" }> {
    const title = String(opts.title ?? "").trim();
    if (!title) throw new Error("delegate: title is required");
    if (!Array.isArray(opts.tasks) || opts.tasks.length === 0) throw new Error("delegate: tasks must not be empty");
    // A delegated child is a fork in lineage/workspace, not a full transcript copy.
    // The task packet below is its bounded projection; offset 0 keeps the noisy
    // parent history out of the child context.
    const child = await ctx.fns.session.fork({ id: opts.agent.id, title, offset: 0, visibility: "team" });
    child.scratchpad = {
        delegation: { parentId: opts.agent.id, status: "working", title, createdAt: Date.now() },
    };
    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
    await ctx.fns.session.plan({ agent: child, title, tasks: opts.tasks });
    const taskText = opts.tasks.map((task, index) => String(index + 1) + ". [" + task.id + "] " + task.title + (task.instructions ? ": " + task.instructions : "")).join("\n");
    const prompt = ["You are a delegated subagent working for a parent agent.", "Execute the visible task plan in order. After each task is actually complete, call session.done({ agent, id }).", "When the entire plan is complete, you MUST call agent.finishTask({ agent, summary, result }) with a concrete JSON-compatible result. Completion without result is invalid.", "Keep noisy tool output in this child session; return a concise parent-facing summary.", "Do not ask the user questions. If blocked, call agent.steer({ from: agent, event: 'blocked', summary }).", "", "Plan:", taskText].join("\n");
    await ctx.fns.session.appendUserMessage({ id: child.id, text: prompt, author: "agent:" + opts.agent.id, eventExtra: { agentMessage: { from: opts.agent.id, title: String(opts.agent.title ?? ""), body: prompt } } });
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: "UPDATE agents SET next_run_at = COALESCE(next_run_at, ?), updated_at = ? WHERE id = ? AND archived_at IS NULL",
        params: [now, now, child.id],
    });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: opts.agent.id, section: "team", reason: "delegate" });
    return { id: child.id, status: "working" as const };
}
