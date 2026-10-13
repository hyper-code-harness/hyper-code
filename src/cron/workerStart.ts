/**
 * Starts one tracked cron worker without recovering database runs
 *
 * Lifecycle-only hot-handoff entry point. Rejects legacy untracked or draining workers. Concurrent starts share one worker; recovery is reserved for cold process boot.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ generation: number; started: boolean }> {
    if (session) throw new Error("cron.workerStart is a lifecycle-only entry point");
    const state = ((ctx.state as any).cron ??= {});
    if (state.workerBootPromise) throw new Error("cron worker cold boot is in progress");
    if (state.running && !state.workerPromise) throw new Error("legacy cron worker requires observed drain; start refused");
    if (state.workerStopping) throw new Error("cron worker is draining; await workerStop before starting");
    if (state.workerPromise) return { generation: state.workerGeneration, started: false };
    const generation = Number(state.workerGeneration ?? 0) + 1;
    state.workerGeneration = generation;
    state.running = true;
    const promise = Promise.resolve().then(() => ctx.fns.cron.workerLoop({})).finally(() => {
        if (state.workerGeneration === generation && state.workerPromise === promise) {
            state.running = false;
            state.workerPromise = undefined;
            state.workerCapabilityGeneration = undefined;
        }
    });
    state.workerPromise = promise;
    void promise.catch((error: Error) => ctx.fns.procs.log.error({event:"cron.worker.crashed",msg:String(error?.stack ?? error)}));
    return {generation,started:true};
}
