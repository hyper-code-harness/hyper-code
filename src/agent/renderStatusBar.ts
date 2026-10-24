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
    let label: string;
    let title: string;
    let cls: string;
    let borderCls = '';


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
        // A ring of dots with the run time inside: 3 dots to start with, one more per tool call, so the
        // ring fills as the agent works. It turns slowly while events flow and goes amber after a quiet minute.
        const still = quiet != null && quiet > 60;
        // No mark in the header while running: the arc around the stop button says "running" and the clock at the
        // end of the tool row says how long. Only a quiet minute shows here, as a warning.
        label = still ? runRing({ seconds: elapsedMs / 1000, dots: 3 + tools, still }) : '';
        title = `running ${(elapsedMs / 1000).toFixed(0)}s · ${tools} tool call${tools === 1 ? '' : 's'}${quiet != null ? ` · last event ${quiet}s ago` : ''}`;
        cls = still ? 'text-warning' : 'text-blue-500';
    } else if (row?.next_run_at) {
        const waits = Math.max(0, (Number(row.next_run_at) - now) / 1000).toFixed(1);
        label = `<i class="ph ph-clock-countdown" aria-hidden="true"></i><span>${waits}s</span>`;
        title = `queued · ${waits}s`;
        cls = 'text-warning';
    } else if (parked) {
        // Parked is a WAIT, not a breakage: the quota is spent and the agent
        // already holds a wake-up for the reset moment. Red would say "fix me"
        // when there is nothing to fix, so this state is yellow and states when
        // the work resumes.
        const until = Number(parked.resetsAt ?? parked.wakeAt ?? 0);
        const left = until ? humanDelay(until - now) : null;
        label = `<i class="ph ph-pause-circle" aria-hidden="true"></i><span>parked${left ? ` · ${left}` : ''}</span>`;
        title = `${parked.message ?? 'usage limit'} The agent will wake automatically.`;
        cls = 'text-warning bg-warning/10 border-ui-border';
    } else if (row?.last_error) {
        // A failed run does NOT auto-retry (by design) — without this badge it
        // looks like a hang. The next user message retries; say so.
        label = 'error';
        title = 'error';
        cls = 'text-error bg-error/10 border-ui-border';
    } else {
        label = '';
        title = 'idle';
        cls = 'text-faint';
        borderCls = '';
    }

    const url = `/agent/${encodeURIComponent(agentId)}/statusbar`;
    const esc = (t: any) => ctx.fns.procs.ui.escape({ text: t });
    const statusBadge = row?.last_error && row?.run_state !== 'running' && !parked
        ? `<span class="text-xs px-2 py-0.5 rounded border font-mono ${cls} max-w-[16rem] truncate inline-block align-bottom" title="${esc(String(row.last_error))} — send a message to retry">error: ${esc(String(row.last_error).slice(0, 48))}</span>`
        : row?.run_state === 'running' ? `<span class="inline-flex items-center ${cls}" title="${esc(title)}" data-agent-running>${label}</span>`
        : label ? `<span class="text-xs px-1.5 py-0.5 rounded ${borderCls} font-mono inline-flex items-center gap-1.5 ${cls}" title="${esc(title)}"${row?.run_state === 'running' ? ' data-agent-running' : ''}>${label}</span>` : '';
    // Stop is rendered by this live fragment so it appears and disappears with
    // the run, but CSS anchors it inside the composer instead of the top bar.
    const busy = row?.run_state === 'running' || !!row?.next_run_at;
    const stopBtn = busy
        ? ctx.fns.procs.ui.button({ action: 'stop', entity: 'agent', id: agentId, post: `/agent/${encodeURIComponent(agentId)}/stop`, swap: 'none', title: 'stop this run', ariaLabel: 'Stop generation', tone: 'primary', class: 'size-8 rounded-full shadow-md', html: '<span class="block size-2.5 rounded-[2px] bg-base-100" aria-hidden="true"></span>' })
        : `<button type="submit" class="flex size-8 items-center justify-center rounded-full bg-base-content text-base-100 shadow-sm transition hover:opacity-85" title="Send · Enter" aria-label="Send message"><i class="ph ph-arrow-up text-base" aria-hidden="true"></i></button>`;
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
        attrs: 'class="flex items-center gap-2"',
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
// The running mark: a 28px ring of dots (3 + tool calls, up to a full ring of 24) around the run time.
// "42s" under a minute, then "7m" / "2h" — the exact time and count are in the tooltip.
function runRing(o: { seconds: number; dots: number; still: boolean }): string {
    const n = Math.max(3, Math.min(24, Math.floor(o.dots)));
    const s = Math.max(0, Math.floor(o.seconds));
    const text = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
    const dots = Array.from({ length: n }, (_, i) => {
        const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
        const x = (14 + 11.5 * Math.cos(a)).toFixed(2), y = (14 + 11.5 * Math.sin(a)).toFixed(2);
        const op = (0.35 + 0.65 * (i + 1) / n).toFixed(2);
        return `<circle cx="${x}" cy="${y}" r="1.5" fill="currentColor" opacity="${op}"/>`;
    }).join('');
    return `<svg class="chat-run-ring${o.still ? '' : ' chat-run-ring--live'}" width="22" height="22" viewBox="0 0 28 28" aria-hidden="true">`
        + `<g class="chat-run-dots">${dots}</g>`
        + `<text x="14" y="17.2" text-anchor="middle" font-size="${text.length > 2 ? 9 : 10}" font-weight="600" fill="currentColor" font-family="ui-sans-serif,system-ui">${text}</text></svg>`;
}
