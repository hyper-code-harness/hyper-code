/**
 * Changes one task of an agent's plan as a person does in a to-do list: add, tick off, reopen, remove, rename, reorder.
 *
 * Use for a single change made by hand (the plan popup, agent.planPopup); the agent itself keeps using session.plan, session.done and session.updatePlan. add appends a task to the queue and creates the plan when the chat has none; done ticks a task off — the current one through session.done, a queued one is skipped; reopen puts a finished task first in the queue; remove deletes a task that has not started; rename changes a title; detach takes one attached file off a task; move reorders the queue by the given ids — and, while the plan is paused, the current task with it: the first one becomes current. Tasks are kept in one order: finished, the current one, the queue. When the change makes another task current while the agent is idle, the plan is paused, so its clock does not run until agent.continuePlan or a new message starts the work.
 * @param opts.agent Agent that owns the plan; defaults to the current session agent.
 * @param opts.action The change to make.
 * @param opts.id Task the change applies to; required for done, reopen, remove and rename.
 * @param opts.title Task title of 1–300 characters; required for add and rename.
 * @param opts.instructions For add: what the task means in full (up to 12 000 characters), shown to the agent with the task.
 * @param opts.file For detach: id of the attachment to take off the task (session.attachToTask put it there).
 * @param opts.order For move: ids of the queued tasks in their new order (with the current one while the plan is paused); tasks not listed keep their relative order after the listed ones.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent that owns the plan; defaults to the current session agent. */
        agent?: types.agent.Agent;
        /** The change to make. */
        action: "add" | "done" | "reopen" | "remove" | "rename" | "move" | "detach";
        /** Task the change applies to; required for done, reopen, remove and rename. */
        id?: string;
        /** Task title of 1–300 characters; required for add and rename. */
        title?: string;
        /** For add: what the task means in full (up to 12 000 characters), shown to the agent with the task. */
        instructions?: string;
        /** For detach: id of the attachment to take off the task (session.attachToTask put it there). */
        file?: string;
        /** For move: ids of the queued tasks in their new order (with the current one while the plan is paused); tasks not listed keep their relative order after the listed ones. */
        order?: string[];
    },
): Promise<{ ok: true; plan: any; added: string | null }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("editPlanTask: agent is required");
    const action = String(opts.action ?? "");
    if (!["add", "done", "reopen", "remove", "rename", "move", "detach"].includes(action)) throw new Error("editPlanTask: unknown action " + JSON.stringify(action));
    const id = String(opts.id ?? "").trim();
    const title = String(opts.title ?? "").replace(/\s+/g, " ").trim();
    if ((action === "add" || action === "rename") && (!title || title.length > 300)) throw new Error("editPlanTask: a task title of 1–300 characters is required");
    if (action !== "add" && action !== "move" && !id) throw new Error("editPlanTask: id is required");
    const instructions = action === "add" ? String(opts.instructions ?? "").trim() : "";
    if (instructions.length > 12_000) throw new Error("editPlanTask: the text of a task is 12 000 characters at most");
    const order = Array.isArray(opts.order) ? opts.order.map(String) : [];
    
    // Is the agent working (or about to)? A task that becomes current while nobody works must not run its clock.
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT run_state, next_run_at FROM agents WHERE id = ?", params: [agent.id] }) as Array<{ run_state: string | null; next_run_at: number | string | null }>;
    const due = rows[0]?.next_run_at == null ? null : Number(rows[0].next_run_at);
    const busy = rows[0]?.run_state === "running" || (due !== null && due <= Date.now() + 1000);
    
    const tasksNow: any[] = Array.isArray(agent.scratchpad?.plan?.tasks) ? agent.scratchpad.plan.tasks : [];
    const wasActive: string | null = tasksNow.find(task => task.status === "active")?.id ?? null;
    // The current task is finished the way the agent finishes it: time banked, the next one started, the parent told.
    if (action === "done" && wasActive !== null && String(wasActive) === id) await ctx.fns.session.done({ agent, id });
    
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
        let plan = scratchpad.plan;
        if (!plan || !Array.isArray(plan.tasks)) {
            if (action !== "add") throw new Error("editPlanTask: this chat has no plan");
            plan = scratchpad.plan = { version: 1, title: "", tasks: [], createdAt: now, updatedAt: now, pausedAt: null };
        }
        const tasks: any[] = plan.tasks;
        const find = () => {
            const task = tasks.find(item => String(item?.id) === id);
            if (!task) throw new Error("editPlanTask: unknown task " + JSON.stringify(id));
            return task;
        };
        let added: string | null = null;
        let first: any = null;
        if (action === "add") {
            const ids = new Set(tasks.map(task => String(task.id)));
            let n = tasks.length + 1;
            while (ids.has("task-" + n)) n++;
            added = "task-" + n;
            tasks.push({ id: added, title, instructions, status: "pending", startedAt: null, activeSince: null, elapsedMs: 0, completedAt: null });
        } else if (action === "rename") {
            find().title = title;
        } else if (action === "done") {
            const task = find();
            if (task.status !== "done") {
                if (task.activeSince) task.elapsedMs = Math.max(0, Number(task.elapsedMs ?? 0)) + Math.max(0, now - Number(task.activeSince));
                task.activeSince = null;
                task.completedAt = now;
                task.status = "done";
            }
        } else if (action === "reopen") {
            const task = find();
            if (task.status === "done") { task.status = "pending"; task.completedAt = null; task.activeSince = null; first = task; }
        } else if (action === "detach") {
            const task = find();
            const file = String(opts.file ?? "");
            const kept = (Array.isArray(task.attachments) ? task.attachments : []).filter((item: any) => String(item?.attachmentId) !== file);
            if (!file || kept.length === (task.attachments?.length ?? 0)) throw new Error("editPlanTask: unknown file " + JSON.stringify(file));
            task.attachments = kept;
        } else if (action === "remove") {
            const task = find();
            if (task.status !== "pending") throw new Error("editPlanTask: only a task that has not started can be removed");
            tasks.splice(tasks.indexOf(task), 1);
        }
        // One order everywhere: finished, the current one, then the queue (session.updatePlan relies on it).
        const done = tasks.filter(task => task.status === "done");
        const active = tasks.filter(task => task.status === "active");
        let pending = tasks.filter(task => task.status !== "done" && task.status !== "active");
        if (first) pending = [first, ...pending.filter(task => task !== first)];
        if (action === "move") {
            const rank = new Map(order.map((taskId, index) => [taskId, index] as const));
            // While the plan waits nobody is on the current task, so it is part of the queue: the first one is current.
            const open = plan.pausedAt ? [...active, ...pending] : pending;
            const at = (task: any) => rank.get(String(task.id)) ?? order.length + open.indexOf(task);
            const sorted = [...open].sort((a, b) => at(a) - at(b));
            if (plan.pausedAt && sorted.length) {
                for (const task of sorted) {
                    if (task.activeSince) task.elapsedMs = Math.max(0, Number(task.elapsedMs ?? 0)) + Math.max(0, now - Number(task.activeSince));
                    task.activeSince = null;
                    task.status = "pending";
                }
                sorted[0].status = "active";
                sorted[0].startedAt ??= now;
                active.splice(0, active.length, sorted[0]);
                pending = sorted.slice(1);
            } else pending = sorted;
        }
        let current = active[0];
        if (!current && pending.length) {
            current = pending.shift();
            current.status = "active";
            current.startedAt ??= now;
            current.activeSince = now;
            active.push(current);
        }
        // A task that became current here while the agent is idle waits: the plan is paused until someone starts it.
        if (current && String(current.id) !== String(wasActive ?? "")) {
            if (busy) { plan.pausedAt = null; current.activeSince ??= now; }
            else {
                if (current.activeSince) current.elapsedMs = Math.max(0, Number(current.elapsedMs ?? 0)) + Math.max(0, now - Number(current.activeSince));
                current.activeSince = null;
                plan.pausedAt ??= now;
            }
        }
        plan.tasks = [...done, ...active, ...pending];
        plan.updatedAt = now;
        return { plan, added };
    } });
    agent.scratchpad = updated.scratchpad;
    ctx.fns.events.refreshAgentMeta({ agentId: agent.id, section: "plan", reason: "plan-" + action });
    if (agent.parentId) ctx.fns.events.refreshAgentMeta({ agentId: String(agent.parentId), section: "team", reason: "team-plan" });
    return { ok: true, plan: updated.result.plan, added: updated.result.added };
}
