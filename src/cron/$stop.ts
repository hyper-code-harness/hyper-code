/** Stops the embedded cron worker during graceful process shutdown. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    if (_session) throw new Error("cron stop is lifecycle-only");
    return ctx.fns.cron.workerStop({});
}
