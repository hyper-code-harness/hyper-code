/**
 * Draws an agent as a list row or a card: its chat icon, title, id, project and state (running, unread).
 * @param opts.agentId Agent to show.
 * @param opts.variant Row for lists, card for dashboards. @default "row"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent to show. */
    agentId: string;
    /** Row for lists, card for dashboards. @default "row" */
    variant?: "row" | "card";
}): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const a: any = ((await ctx.fns.procs.db.select({ sql: "SELECT a.id, a.title, a.icon, a.model, a.run_state, p.title AS project FROM agents a LEFT JOIN projects p ON p.id = a.project_id WHERE a.id = ?", params: [opts.agentId] }).catch(() => [])) as any[])[0];
    if (!a) return ctx.fns.w.listRow({ label: `unknown agent ${opts.agentId}`, icon: "question" });
    const running = a.run_state && a.run_state !== "idle";
    const lead = ctx.fns.w.chatIcon({ icon: a.icon ?? "", model: String(a.model ?? ""), size: "sm", active: running });
    if (opts.variant === "card") return ctx.fns.w.card({ body: `<div class="w-agent-card">${ctx.fns.w.chatIcon({ icon: a.icon ?? "", model: String(a.model ?? ""), size: "md", active: running })}<div><div class="w-agent-title">${esc(a.title || a.id)}</div><div class="w-row-detail">${esc(a.id)}${a.project ? ` · ${esc(a.project)}` : ""} · ${esc(String(a.model ?? "").split(":").pop())}</div></div></div>` });
    return ctx.fns.w.listRow({ label: String(a.title || a.id), lead, hint: a.project ? String(a.project) : String(a.id), dot: running ? "running" : undefined, action: { href: `/agent/${encodeURIComponent(a.id)}` } });
}
