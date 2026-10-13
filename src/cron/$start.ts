/** Starts the embedded cron worker after recovering jobs interrupted by a previous process exit. */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    if (_session) throw new Error("cron start is lifecycle-only");
    if (ctx.env.CRON_WORKER === "off") {
        ctx.fns.procs.log.info({ event: "cron.worker.disabled", msg: "embedded cron worker disabled by CRON_WORKER=off" });
        return {};
    }
    const state = ((ctx.state as any).cron ??= {});
    if (state.workerBootPromise) return state.workerBootPromise;
    if (state.running || state.workerPromise || state.workerGeneration) return ctx.fns.cron.workerStart({});
    const boot = Promise.resolve().then(async () => {
        await ctx.fns.cron.recover({});
        await ctx.fns.cron.reconcile({});
        state.workerBootPromise = undefined;
        return ctx.fns.cron.workerStart({});
    }).finally(() => { if (state.workerBootPromise === boot) state.workerBootPromise = undefined; });
    state.workerBootPromise = boot;
    return boot;
}
