/** Sends a heartbeat to the Hyper Control Plane now and every 5 minutes, when connected. Never blocks startup. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const beat = () => ctx.fns.controlPlane.heartbeat({}).then((r) => {
        if (r) ctx.fns.procs.log.debug({ event: "controlPlane.heartbeat", msg: `as ${r.service}` });
    }).catch((e: any) => ctx.fns.procs.log.warn({ event: "controlPlane.heartbeat.failed", msg: String(e?.message ?? e) }));
    queueMicrotask(beat);
    const timer = setInterval(beat, 5 * 60 * 1000);
    return { timer };
}
