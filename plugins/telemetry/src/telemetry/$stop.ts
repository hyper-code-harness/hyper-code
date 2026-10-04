// Stop the maintenance timer. Pages are plain files; nothing else to release.
/**
 * Stop telemetry storage maintenance and release its timer.
 */
export default function (ctx: Context, _session: Session | null, _opts?: {}) {
    const state = (ctx.state as any)?.telemetry as { timer?: ReturnType<typeof setInterval> } | undefined;
    if (state?.timer) clearInterval(state.timer);
}
