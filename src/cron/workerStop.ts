/**
 * Drains the tracked cron worker without recovering or resetting database jobs
 *
 * Lifecycle-only stop that awaits all owned work. Refuses untracked legacy loops because their completion cannot be observed. Await this before reload and workerStart.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ generation: number; stopped: boolean }> {
    if (session) throw new Error("cron.workerStop is a lifecycle-only entry point");
    const state = ((ctx.state as any).cron ??= {});
    if (state.workerBootPromise) await state.workerBootPromise;
    if (state.running && !state.workerPromise) throw new Error("legacy cron worker requires observed drain; stop refused");
    const promise = state.workerPromise;
    const generation = Number(state.workerGeneration ?? 0);
    if (!promise) return {generation,stopped:false};
    state.workerStopping = true;
    state.running = false;
    await ctx.fns.cron.wakeWorker({});
    try { await promise; }
    finally { if (state.workerGeneration === generation) state.workerStopping = false; }
    return {generation,stopped:true};
}
