/** Done for the runtime. */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live agent instance to operate on. */
    agent?: types.agent.Agent;
        /** Agent identifier. */
    id: string },
): Promise<any> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("done: agent is required");
    const id = String(opts.id ?? "").trim();
    if (!id) throw new Error("done: id is required");

    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
        const plan = scratchpad.plan;
        if (!plan || !Array.isArray(plan.tasks)) throw new Error("done: no active plan");
        const task = plan.tasks.find((item: any) => item?.id === id);
        if (!task) throw new Error(`done: unknown task id "${id}"`);
        const alreadyDone = task.status === "done";
        if (!alreadyDone) {
            if (task.status !== "active") throw new Error(`done: task "${id}" is not active`);
            if (task.activeSince) task.elapsedMs = Math.max(0, Number(task.elapsedMs ?? 0)) + Math.max(0, now - Number(task.activeSince));
            task.activeSince = null;
            task.completedAt = now;
            task.status = "done";
        }

        let next = plan.tasks.find((item: any) => item.status === "active");
        if (!next) {
            next = plan.tasks.find((item: any) => item.status === "pending");
            if (next) {
                next.status = "active";
                next.startedAt ??= now;
                next.activeSince = now;
            }
        }
        plan.updatedAt = now;
        plan.pausedAt = null;
        const done = plan.tasks.filter((item: any) => item.status === "done").length;
        return {
            alreadyDone,
            completed: { id: task.id, title: task.title, elapsedMs: task.elapsedMs },
            next: next ? { id: next.id, title: next.title, instructions: next.instructions } : null,
            complete: !next,
            progress: { done, total: plan.tasks.length },
        };
    } });
    agent.scratchpad = updated.scratchpad;
    ctx.fns.events.refreshAgentMeta({ agentId: agent.id, section: "plan", reason: "plan-done" });
    if (!updated.result.alreadyDone && agent.parentId && agent.scratchpad?.delegation) {
        await ctx.fns.agent.steer({
            from: agent,
            // The final task is announced by finishTask with its mandatory
            // semantic result. Emitting a generic plan.completed here would
            // duplicate the parent update and wake.
            event: "task.completed",
            taskId: updated.result.completed.id,
            taskTitle: updated.result.completed.title,
            summary: updated.result.complete
                ? `Completed final plan task ${updated.result.progress.done}/${updated.result.progress.total}; preparing required result.`
                : `Completed plan task ${updated.result.progress.done}/${updated.result.progress.total}.`,
        });
    }
    if (agent.parentId) ctx.fns.events.refreshAgentMeta({ agentId: String(agent.parentId), section: "team", reason: "team-plan-done" });
    // The only moment when "a unit of work ended" is known rather than guessed:
    // the agent said so. Announced, not awaited — a handler that harvests the
    // transcript may cost an LLM round trip, and closing a task must not wait
    // for it or fail with it.
    if (!updated.result.alreadyDone) {
        const completed = updated.result.completed;
        queueMicrotask(() => ctx.fns.procs.hooks.run({
            name: "session.taskDone",
            opts: {
                agentId: agent.id,
                taskId: completed.id,
                taskTitle: completed.title,
                elapsedMs: completed.elapsedMs,
                complete: updated.result.complete,
                next: updated.result.next?.id ?? null,
            },
        }).catch((error: any) => ctx.fns.procs.log.warn({ event: "session.task-done.hook", msg: String(error?.message ?? error), agentId: agent.id, taskId: completed.id })));
    }
    return { ok: true, ...updated.result };
}
