/** Performs the ui.wakeTimer runtime operation. */
/**
 * Render the wake-up timer controls for an agent.
 * @param opts.agent Agent associated with the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {
        /** Agent associated with the operation. */ agent: types.agent.Agent }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const wakeAt = Number(opts.agent.wakeAt ?? 0);
    if (!wakeAt) return `<span id="wake-timer-${esc(opts.agent.id)}" class="text-3xs text-faint">not scheduled</span>`;
    const remaining = Math.max(0, wakeAt - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const countdown = days ? `${days}d ${hours}h ${minutes}m` : hours ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    return `<span id="wake-timer-${esc(opts.agent.id)}" data-wake-at="${wakeAt}" class="wake-timer inline-block w-[5.5rem] shrink-0 whitespace-nowrap text-right font-mono text-xs font-normal tabular-nums text-subtle" title="${esc(new Date(wakeAt).toLocaleString())}">${esc(countdown)}</span>`;
}
