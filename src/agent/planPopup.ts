/**
 * Shows a chat's plan in the app popup as a to-do list the person edits: add tasks, tick them off, reorder the queue, rename, remove, start the work.
 *
 * Opened by the plan count in the message box (agent.planBadge) or the Work card of the chat panel. The list is
 * w.todo: the task in work on top with its instructions and a running clock, then the queue (drag to reorder), the
 * field that adds a task (with images and files — paste, drop or the paperclip), the finished tasks at the bottom with the time each took, and a footer with the count and Start. Without `action` it only
 * reads; with one it applies that change (session.editPlanTask, agent.continuePlan) and answers with the new list.
 * A chat without a plan gets an empty list: the first task added creates the plan.
 * @param opts.agentId Chat whose plan is shown.
 * @param opts.action Change to apply before drawing: add, done, reopen, remove, rename, move, detach (session.editPlanTask), start (agent.continuePlan — tell the agent to work on the current task), edit (open the agent inspector with the full plan editor on the canvas and close the popup).
 * @param opts.id Task the change applies to (done, reopen, remove, rename).
 * @param opts.title New task title (add, rename).
 * @param opts.order Ids of the queued tasks in their new order (move).
 * @param opts.file Attachment to take off the task (detach).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Chat whose plan is shown. */
        agentId: string;
        /** Change to apply before drawing: add, done, reopen, remove, rename, move, detach (session.editPlanTask), start (agent.continuePlan — tell the agent to work on the current task), edit (open the agent inspector with the full plan editor on the canvas and close the popup). */
        action?: "add" | "done" | "reopen" | "remove" | "rename" | "move" | "detach" | "start" | "edit";
        /** Task the change applies to (done, reopen, remove, rename). */
        id?: string;
        /** New task title (add, rename). */
        title?: string;
        /** Ids of the queued tasks in their new order (move). */
        order?: string[];
        /** Attachment to take off the task (detach). */
        file?: string;
    },
): Promise<Response> {
    const w = ctx.fns.w;
    const esc = (text: unknown) => w.escape({ text: String(text ?? "") });
    const agentId = String(opts.agentId ?? "");
    const reply = (title: string, html: string) =>
        new Response(ctx.fns.ui.popupContent({ title, html }), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (!agentId || !(await ctx.fns.jobs.canSee({ agentId }))) return reply("Plan", w.empty({ title: "Not your chat", tone: "danger" }));
    const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
    if (!agent) return reply("Plan", w.empty({ title: `No chat ${agentId}`, tone: "danger" }));

    let error = "";
    const action = String(opts.action ?? "");
    try {
        if (action === "edit") {
            // The full editor (instructions, plan title, archive) lives in the agent inspector: open it on the canvas
            // and close this popup (an empty answer).
            await ctx.fns.canvas.show({ agentId, kind: "view", args: { fn: "agent.inspector", params: { agentId } }, title: "Agent" });
            return new Response("", { headers: { "content-type": "text/html; charset=utf-8" } });
        }
        if (action === "start") await ctx.fns.agent.continuePlan({ agent });
        else if (action === "add" || action === "done" || action === "reopen" || action === "remove" || action === "rename" || action === "move" || action === "detach")
            await ctx.fns.session.editPlanTask({ agent, action, id: opts.id, title: opts.title, order: opts.order, file: opts.file });
        else if (action) error = `Unknown action ${action}`;
    } catch (failure: any) {
        error = String(failure?.message ?? failure).replace(/^(editPlanTask|continuePlan|done): /, "");
        error = error.charAt(0).toUpperCase() + error.slice(1);
    }

    const plan: any = agent.scratchpad?.plan;
    const tasks: any[] = Array.isArray(plan?.tasks) ? plan.tasks : [];
    const done = tasks.filter(t => t.status === "done").length;
    const paused = !!plan?.pausedAt;
    const state = !tasks.length ? "waiting" : done === tasks.length ? "done" : paused ? "waiting" : "working";
    const short = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`; };
    const total = tasks.reduce((sum, t) => sum + Math.max(0, Number(t.elapsedMs ?? 0)), 0);
    // A task made from a whole message keeps the message as its instructions, first line included: not said twice.
    const more = (task: any) => { const text = String(task.instructions ?? "").trim(), title = String(task.title ?? "").replace(/…$/, ""); return (text.startsWith(title) ? text.slice(title.length) : text).trim(); };
    const items = tasks.map(task => {
        const status = task.status === "done" ? "done" as const : task.status === "active" ? "active" as const : "pending" as const;
        const spent = Math.max(0, Number(task.elapsedMs ?? 0));
        const running = status === "active" && !paused && !!task.activeSince;
        return {
            id: String(task.id), title: String(task.title ?? ""), status,
            // What the task says beyond its title: in full for the one in work, two lines for a queued one (w.todo).
            note: status === "done" ? undefined : more(task).slice(0, 600) || undefined,
            // A running task ticks from where it is now (its banked time moved back from its start); the others show what they took.
            since: running ? Number(task.activeSince) - spent : undefined,
            time: !running && spent >= 1000 ? short(spent) : undefined,
            // Images and files the person attached (session.attachToTask), served like a chat message's attachments.
            files: (Array.isArray(task.attachments) ? task.attachments : []).filter((file: any) => file?.attachmentId).map((file: any) => ({ id: String(file.attachmentId), name: String(file.fileName ?? "file"), url: `/attachments/${encodeURIComponent(agentId)}/${encodeURIComponent(String(file.attachmentId))}`, image: file.type === "image_ref" })),
        };
    });
    const started = tasks.some(t => t.status === "done" || Number(t.elapsedMs ?? 0) > 0);
    const count = `${done} of ${tasks.length} done`;
    const summary = !tasks.length ? "" : [state === "done" ? "All done" : paused ? `${started ? "Paused" : "Not started"} · ${count}` : count, total >= 1000 ? short(total) : ""].filter(Boolean).join(" · ");
    const list = w.todo({
        items, state, summary, error,
        rpc: { method: "agent.planPopup", params: { agentId } },
        topic: `agent:${agentId}`,
        attach: `/agent/${encodeURIComponent(agentId)}/plan/attach`,
        // Waiting with something to do: one button tells the agent to take the current task.
        start: state === "waiting" && tasks.length ? (started ? "Continue" : "Start") : undefined,
        edit: tasks.length ? "Details" : undefined,
        placeholder: tasks.length ? "Add a task…" : "Add the first task…",
        empty: "This chat has no plan yet. Write the tasks, then press Start — the agent takes them one by one.",
    });
    // The list sits closer to the popup's edges than plain content does: its rows carry their own padding, so the
    // marks — not the row backgrounds — line up with the popup's title.
    return reply(String(plan?.title || "Plan"), `<div class="-m-2">${list}</div>`);
}
