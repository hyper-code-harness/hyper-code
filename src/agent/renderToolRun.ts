/**
 * Draws a run of consecutive tool_call events as one w.toolGroup row, with the call in progress as its last cell.
 *
 * The row's id is `tools-<idx of the run's first call>`, so a later render of the same run (the live tail adding a
 * call, the running call starting or ending) replaces it in place with an out-of-band swap.
 * @param opts.agentId Agent whose transcript holds the calls.
 * @param opts.events The tool_call events of the run, oldest first; may be empty when only a running call is drawn.
 * @param opts.running Append the agent's running tool call (agent.runningToolCall), if any. @default false
 * @param opts.oob Mark the row for an htmx out-of-band outerHTML swap. @default false
 * @param opts.elapsedMs A finished row's time (the last row of a turn: the turn's time), drawn in grey after it.
 * @param opts.turnSince Start of the agent's turn in progress (ms): the row ends in its live overall clock, and with no
 * call running the last cell is a glowing "thinking" cell (the model is working). Omit when the turn is over.
 *
 * A call whose event carries `thinkMs` of a second or more gets a "thinking" cell before it: the time the model took
 * for the reply that made the call.
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
    /** Start of the agent's turn in progress, ms since epoch: adds the overall clock and the live thinking cell. */
    turnSince?: number;
    /** A finished row's time in ms (the last row of a turn: the turn's time), drawn in grey after it. @minimum 0 */
    elapsedMs?: number;
}): string {
    type Cell = { icon: string; title: string; error?: boolean; running?: boolean; action?: types.w.Action };
    const calls: Cell[] = [];
    for (const event of opts.events) {
        const ms = Number(event?.thinkMs ?? 0);
        if (ms >= 1000) calls.push(thinking(ms));
        calls.push(ctx.fns.agent.toolCallCell({ event, agentId: opts.agentId }));
    }
    const live = opts.running ? ctx.fns.agent.runningToolCall({ agentId: opts.agentId }) : null;
    if (live) calls.push({ icon: live.icon, title: live.title, running: true, action: live.action });
    else if (opts.running && opts.turnSince) calls.push({ icon: "brain", title: "thinking", running: true });
    if (!calls.length) return "";
    const runningSince = opts.running ? (opts.turnSince ?? live?.startedAt) : undefined;
    const first = opts.events[0]?.idx;
    const id = first != null ? `tools-${Number(first)}` : "tools-live";
    return `<div id="${id}" class="chat-tools"${opts.oob ? ' hx-swap-oob="outerHTML"' : ""}>`
        + ctx.fns.w.toolGroup({ calls, runningSince, elapsed: !runningSince && Number(opts.elapsedMs) >= 1000 ? clock(Number(opts.elapsedMs)) : undefined })
        + `</div>`;
}

function clock(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
}

// A "thinking" cell: the model's time for one reply.
function thinking(ms: number): { icon: string; title: string } {
    return { icon: "brain", title: `thought ${clock(ms)}` };
}
