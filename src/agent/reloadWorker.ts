/**
 * Gracefully replace the in-process worker loop after its current work finishes
 *
 * Use after hot-loading workerLoop: an already running loop keeps its old lexical code. Stops new claims, waits for the tracked loop and its in-flight turns to settle, then starts the hot-loaded loop. Does not abort agents, cancel jobs, change cursors, or restart the server. New work remains durably queued during the drain. Concurrent requests share one handoff.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ reloaded: true }> {
    const state = ctx.state as typeof ctx.state & { workerLoopRunning?: boolean; workerLoopPromise?: Promise<unknown>; workerLoopHandoff?: Promise<{reloaded:true}>; compactionQueueWorker?: boolean };
    if (state.workerLoopHandoff) return await state.workerLoopHandoff;
    const handoff = async (): Promise<{reloaded:true}> => {
        const previous = state.workerLoopPromise;
        if (state.workerLoopRunning && !previous) throw new Error("Cannot safely reload an untracked worker loop");
        state.compactionQueueWorker = false;
        state.workerLoopRunning = false;
        ctx.fns.agent.wakeWorker({});
        try { await previous; }
        finally {
            state.workerLoopPromise = ctx.fns.agent.workerLoop({}).catch((error: Error) => {
                console.error("reloaded worker loop failed:", error);
            });
        }
        return { reloaded:true };
    };
    state.workerLoopHandoff = handoff();
    try { return await state.workerLoopHandoff; }
    finally { state.workerLoopHandoff = undefined; }
}
