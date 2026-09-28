/** Stops the periodic heartbeat. */
export default async function (_ctx: Context, _session: Session | null, state?: { timer?: ReturnType<typeof setInterval> }) {
    if (state?.timer) clearInterval(state.timer);
}
