/**
 * Draws a plan: title, progress ring, and tasks with their state (done, active, pending).
 * @param opts.title Plan title.
 * @param opts.tasks Tasks in order.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Plan title. */
    title: string;
    /** Tasks in order. */
    tasks: Array<{ title: string; status: "done" | "active" | "pending" }>;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const done = opts.tasks.filter(t => t.status === "done").length;
    const icon = { done: "check-circle", active: "circle-half", pending: "circle" } as const;
    return `<div class="w-plan"><div class="w-plan-head">${ctx.fns.w.ring({ value: done, max: Math.max(1, opts.tasks.length), tone: "accent", label: `${done}/${opts.tasks.length}` })}<span>${esc(opts.title)}</span></div>${opts.tasks.map(t => `<div class="w-plan-task" data-status="${t.status}">${ctx.fns.w.icon({ name: icon[t.status], size: 16 })}<span>${esc(t.title)}</span></div>`).join("")}</div>`;
}
