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
        sql: 'SELECT run_state, run_started_at, next_run_at, last_processed_msg_idx, last_error, wake_at, scratchpad FROM agents WHERE id = ?',
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
        const elapsed = ((now - Number(row.run_started_at ?? now)) / 1000).toFixed(1);
        const lastEv = ((await ctx.fns.procs.db.select({
            sql: 'SELECT MAX(ts) AS t FROM events WHERE agent_id = ?',
            params: [agentId],
        })) as any[])[0];
        const quiet = lastEv?.t ? Math.round((now - Number(lastEv.t)) / 1000) : null;
        label = `<i class="ph ph-spinner-gap animate-spin" aria-hidden="true"></i><span>${elapsed}s${quiet != null && quiet > 10 ? ` · quiet ${quiet}s` : ''}</span>`;
        title = 'running';
        cls = 'text-info';
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
        title = `${parked.message ?? 'usage limit'} Агент проснётся сам.`;
        cls = 'text-warning bg-warning/10 border-ui-border';
    } else if (row?.last_error) {
        // A failed run does NOT auto-retry (by design) — without this badge it
        // looks like a hang. The next user message retries; say so.
        label = 'error';
        title = 'error';
        cls = 'text-error bg-error/10 border-ui-border';
    } else {
        label = '<i class="ph ph-circle" aria-hidden="true"></i>';
        title = 'idle';
        cls = 'text-faint';
        borderCls = '';
    }

    const url = `/agent/${encodeURIComponent(agentId)}/statusbar`;
    const esc = (t: any) => ctx.fns.procs.ui.escape({ text: t });
    const statusBadge = row?.last_error && row?.run_state !== 'running' && !parked
        ? `<span class="text-xs px-2 py-0.5 rounded border font-mono ${cls} max-w-[16rem] truncate inline-block align-bottom" title="${esc(String(row.last_error))} — send a message to retry">error: ${esc(String(row.last_error).slice(0, 48))}</span>`
        : `<span class="text-xs px-2 py-0.5 rounded ${borderCls} font-mono inline-flex items-center gap-1 ${cls}" title="${esc(title)}">${label}</span>`;
    const tokensBadge = usage ? `<span title="context tokens" class="rounded px-1 py-0.5 font-mono text-xs text-muted">${(((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)) / 1000).toFixed(1)}k</span>` : '';
    // Stop is rendered by this live fragment so it appears and disappears with
    // the run, but CSS anchors it inside the composer instead of the top bar.
    const busy = row?.run_state === 'running' || !!row?.next_run_at;
    const stopBtn = busy
        ? ctx.fns.procs.ui.button({ action: 'stop', entity: 'agent', id: agentId, post: `/agent/${encodeURIComponent(agentId)}/stop`, swap: 'none', title: 'stop this run', ariaLabel: 'Stop generation', tone: 'primary', class: 'size-8 rounded-full shadow-md', html: '<span class="block size-2.5 rounded-[2px] bg-base-100" aria-hidden="true"></span>' })
        : '';
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
        html: `${statusBadge}${tokensBadge}`,
    });
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
