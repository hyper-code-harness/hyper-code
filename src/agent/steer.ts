/**
 * Send a durable team update from a delegated child to its parent
 *
 * Persists a structured progress, completion, blocked, or failure notification in the parent transcript, refreshes both Meta panels, and schedules an idle parent immediately. Use internally when a delegated child changes meaningful task state.
 * @param opts.from Delegated child agent sending the update; its parentId determines the recipient.
 * @param opts.event Team lifecycle event represented by the update.
 * @param opts.summary Short parent-facing description of completed work or a problem.
 * @param opts.taskId Stable child plan task identifier when the event concerns one task.
 * @param opts.taskTitle Human-readable child plan task title when available.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Delegated child agent sending the update; its parentId determines the recipient. */
        from: types.agent.Agent;
        /** Team lifecycle event represented by the update. */
        event: "task.completed" | "plan.completed" | "answer" | "blocked" | "failed";
        /** Short parent-facing description of completed work or a problem. */
        summary: string;
        /** Stable child plan task identifier when the event concerns one task. */
        taskId?: string;
        /** Human-readable child plan task title when available. */
        taskTitle?: string;
    },
): Promise<{ delivered: boolean; parentId: string | null; messageIdx?: number }> {
    const child = opts.from;
    const parentId = child.parentId ? String(child.parentId) : null;
    if (!parentId) return { delivered: false, parentId: null };
    const summary = String(opts.summary ?? "").trim().slice(0, 4000);
    if (!summary) throw new Error("steer: summary is required");
    const taskTitle = opts.taskTitle ? String(opts.taskTitle) : null;
    const content = '<team-update member="' + child.id + '" event="' + opts.event + '">Agent ' + child.id + ' ' + opts.event + (taskTitle ? ' task "' + taskTitle + '"' : '') + '. ' + summary + '</team-update>';
    const ts = Date.now();
    // Message, UI event and the parent's schedule commit together (agent.deliver).
    // The schedule is set even while the parent is running: the worker claim already
    // consumed the previous one, so an update landing during the final model call
    // triggers another pass.
    const message = await ctx.fns.agent.deliver({
        to: parentId,
        type: "team_update",
        text: content,
        author: "agent:" + child.id,
        source: "team-update",
        event: { type: "team_update", event: opts.event, memberId: child.id, taskId: opts.taskId ?? null, taskTitle, summary },
        section: "team",
        now: ts,
    });
    if (opts.event === "blocked" || opts.event === "failed") {
        child.scratchpad ??= {};
        const meta = child.scratchpad.delegation;
        if (meta && typeof meta === "object") {
            meta.status = opts.event;
            meta.summary = summary;
            await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
        }
        // Reporting blocked or failed IS the child's decision to stop: without the pause its next text reply
        // would be answered with a plan reminder and the run would go on.
        if (child.scratchpad.plan && !child.scratchpad.plan.pausedAt) {
            await ctx.fns.session.pausePlan({ agent: child, by: "agent", reason: `${opts.event}: ${summary}` });
        }
    }
    ctx.fns.events.refreshAgentMeta({ agentId: child.id, section: "plan", reason: "team-update" });
    return { delivered: true, parentId, messageIdx: message.messageIdx ?? undefined };
}
