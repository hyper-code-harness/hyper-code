/** Render status bar for the runtime.  * @param opts.agentId Target agent identifier.
 * @param opts.initialUsage Initial token usage shown in the status bar.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent id used by the operation. */
agentId: string;
        /** Initial usage used by the operation. */
initialUsage?: any;
        /** Render only the composer stop control or the informational top-bar status. */
        part?: 'status' | 'stop' }): Promise<string> {
    const { agentId, initialUsage } = opts;
    const part = opts.part ?? 'status';
    let usage = initialUsage;
    const now = Date.now();
    const row = ((await ctx.fns.procs.db.select({
        sql: 'SELECT run_state, run_started_at, next_run_at, last_processed_msg_idx, last_error, scratchpad FROM agents WHERE id = ?',
        params: [agentId],
    })) as any[])[0];
    let parked: any = null;
    try { parked = JSON.parse(String(row?.scratchpad ?? '{}'))?.parked ?? null; } catch { parked = null; }

    if (!usage) {
        const lastEvent = ((await ctx.fns.procs.db.select({
            sql: 'SELECT payload FROM events WHERE agent_id = ? AND type = \'assistant\' ORDER BY idx DESC LIMIT 1',
            params: [agentId],
        })) as any[])[0];
        usage = lastEvent ? JSON.parse(lastEvent.payload).usage : null;
    }
    const w = ctx.fns.w;
    // One quiet badge says what is unusual; a normal run says nothing here (the arc around the stop button
    // and the clock after the tool row already say "running"). The tooltip carries the exact numbers.
    const badge = (text: string, tone: types.w.Tone, tip: string) => w.tooltip({ label: tip, html: w.badge({ text, tone }) });
    let statusBadge = '';
    if (row?.run_state === 'running') {
        const elapsedMs = now - Number(row.run_started_at ?? now);
        const lastEv = ((await ctx.fns.procs.db.select({
            sql: 'SELECT MAX(ts) AS t FROM events WHERE agent_id = ?',
            params: [agentId],
        })) as any[])[0];
        const quiet = lastEv?.t ? Math.round((now - Number(lastEv.t)) / 1000) : null;
        const tools = Number(((await ctx.fns.procs.db.select({
            sql: `SELECT count(*)::int AS n FROM events WHERE agent_id = ? AND type = 'tool_call' AND ts >= ?`,
            params: [agentId, Number(row.run_started_at ?? now)],
        })) as any[])[0]?.n ?? 0);
        const title = `running ${shortDuration(elapsedMs)} · ${tools} tool call${tools === 1 ? '' : 's'}${quiet != null ? ` · last event ${quiet}s ago` : ''}`;
        // Over a minute without a single event is worth a look: the run may be stuck on a slow model or a tool.
        if (quiet != null && quiet > 60) statusBadge = badge(`quiet ${shortDuration(quiet * 1000)}`, 'warning', title);
    } else if (row?.next_run_at) {
        const waits = Math.max(0, (Number(row.next_run_at) - now) / 1000).toFixed(1);
        statusBadge = badge(`queued · ${waits}s`, 'warning', `queued · starts in ${waits}s`);
    } else if (parked) {
        const until = Number(parked.resetsAt ?? parked.wakeAt ?? 0);
        const left = until ? humanDelay(until - now) : null;
        statusBadge = badge(`parked${left ? ` · ${left}` : ''}`, 'warning', `${parked.message ?? 'usage limit'} The agent will wake automatically.`);
    } else if (row?.last_error) {
        const err = String(row.last_error);
        statusBadge = badge(`error: ${err.length > 40 ? err.slice(0, 40) + '…' : err}`, 'danger', `${err} — send a message to retry`);
    }

    const url = `/agent/${encodeURIComponent(agentId)}/statusbar`;
    const busy = row?.run_state === 'running' || !!row?.next_run_at;
    const stopBtn = ctx.fns.w.sendButton({ running: busy, stop: { post: `/agent/${encodeURIComponent(agentId)}/stop`, swap: 'none' }, marks: { action: 'stop', entity: 'agent', id: agentId } });
    if (part === 'stop') return stopBtn;
    // The SSE stream is the real trigger (it dispatches hyper-tick on every
    // agent event); the timer is only a safety net. A busy agent still refreshes
    // often enough to keep its elapsed counter honest, but an idle one costs one
    // request every half minute instead of one per second — three widgets each
    // polling once a second was what made a burst of clicks queue behind the
    // browser's six sockets.
    // A live region: the shared stream tells it when its agent moved, and the
    // interval is only a watchdog. A running agent keeps a short one so the
    // elapsed counter stays honest; an idle one costs a request every half
    // minute instead of one per second.
    return ctx.fns.ui.live({
        id: "status-bar",
        url,
        topic: `agent:${agentId}`,
        every: busy ? 5 : 30,
        // data-agent-running lets the chat header turn its icon ring while the run lasts.
        attrs: `class="${ctx.fns.w.mix({ mixes: [{ layout: 'row', gap: 's2' }] })}"${row?.run_state === 'running' ? ' data-agent-running' : ''}`,
        html: statusBadge,
    });
}
// "8s", "37m", "2h 5m" — the running time at a glance.
function shortDuration(ms: number): string {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    return humanDelay(ms);
}
// "3d 16h", "2h 14m", "8m" — enough to decide whether to wait or switch model.
function humanDelay(ms: number): string {
    const left = Math.max(0, ms);
    const minutes = Math.floor(left / 60_000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `${days}d ${hours % 24}h`;
    if (hours >= 1) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
}
