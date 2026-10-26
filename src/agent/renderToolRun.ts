/**
 * Draws a run of consecutive tool_call events as one w.toolGroup row, with the call in progress as its last cell.
 *
 * The row's id is `tools-<idx of the run's first call>`, so a later render of the same run (the live tail adding a
 * call, the running call starting or ending) replaces it in place with an out-of-band swap.
 * @param opts.agentId Agent whose transcript holds the calls.
 * @param opts.events The tool_call events of the run, oldest first; may be empty when only a running call is drawn.
 * @param opts.running Append the agent's running tool call (agent.runningToolCall), if any. @default false
 * @param opts.oob Mark the row for an htmx out-of-band outerHTML swap. @default false
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose transcript holds the calls. */
    agentId: string;
    /** The tool_call events of the run, oldest first; may be empty when only a running call is drawn. */
    events: any[];
    /** Append the agent's running tool call (agent.runningToolCall), if any. @default false */
    running?: boolean;
    /** Mark the row for an htmx out-of-band outerHTML swap. @default false */
    oob?: boolean;
}): string {
    const calls: Array<{ icon: string; title: string; error?: boolean; running?: boolean; action?: types.w.Action }> =
        opts.events.map(event => ctx.fns.agent.toolCallCell({ event, agentId: opts.agentId }));
    const live = opts.running ? ctx.fns.agent.runningToolCall({ agentId: opts.agentId }) : null;
    if (live) calls.push({ icon: live.icon, title: live.title, running: true, action: live.action });
    if (!calls.length) return "";
    const first = opts.events[0]?.idx;
    const id = first != null ? `tools-${Number(first)}` : "tools-live";
    return `<div id="${id}" class="chat-tools"${opts.oob ? ' hx-swap-oob="outerHTML"' : ""}>`
        + ctx.fns.w.toolGroup({ calls, runningSince: live?.startedAt })
        + `</div>`;
}
