/**
 * Reports whether the embedded cron worker has an observable service-capable lifecycle
 *
 * Read-only deployment diagnostic. A legacy untracked loop is never reported ready; this does not inspect grants or database schema.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ ready: boolean; running: boolean; tracked: boolean; stopping: boolean; legacyRequiresDrain: boolean; generation: number; reason: string }> {
    const state = (ctx.state as any).cron ?? {};
    const running = state.running === true;
    const tracked = !!state.workerPromise;
    const stopping = state.workerStopping === true;
    const legacyRequiresDrain = running && !tracked;
    const ready = running && tracked && !stopping && state.workerCapabilityGeneration === state.workerGeneration;
    return {ready,running,tracked,stopping,legacyRequiresDrain,generation:Number(state.workerGeneration ?? 0),reason:legacyRequiresDrain ? "legacy-worker-untracked" : stopping ? "draining" : ready ? "ready" : running ? "starting" : "stopped"};
}
