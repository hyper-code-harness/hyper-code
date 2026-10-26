/**
 * Describes one finished tool call event as a w.toolGroup cell: its icon, title, error flag and details popup.
 *
 * Use when drawing tool_call transcript events with w.toolGroup; the cell opens agent.toolDetails for the event.
 * Events outside the model context say so in the title.
 * @param opts.event The tool_call transcript event.
 * @param opts.agentId Agent whose transcript holds the event; without it the cell opens no details.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The tool_call transcript event. */
    event: { name?: string; args?: unknown; isError?: boolean; idx?: number; excludedFromLlm?: boolean };
    /** Agent whose transcript holds the event; without it the cell opens no details. */
    agentId?: string;
}): { icon: string; title: string; error?: boolean; action?: types.w.Action } {
    const ev = opts.event;
    const meta = ctx.fns.agent.toolMeta({ name: String(ev.name ?? "tool"), args: ev.args });
    const title = (`${meta.label} ${meta.subject}`.trim() || String(ev.name ?? "tool")) + (ev.excludedFromLlm ? " (outside context)" : "");
    const action: types.w.Action | undefined = opts.agentId && ev.idx != null
        ? { popup: { method: "agent.toolDetails", params: { agentId: opts.agentId, idx: Number(ev.idx) } } }
        : undefined;
    return { icon: String(meta.icon).replace(/^ph-/, ""), title, error: !!ev.isError, action };
}
