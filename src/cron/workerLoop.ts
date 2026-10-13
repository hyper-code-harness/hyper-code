/**
 * Drains due cron tasks inside the current Bun process.
 *
 * Runs the embedded database-backed scheduler with bounded concurrency and a polling fallback; start it from the cron lifecycle hook.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<void> {
    if (session) throw new Error("cron.workerLoop is a lifecycle-only entry point");
    const state = ((ctx.state as any).cron ??= {}); const inflight = new Set<Promise<any>>(); const maxParallel = 4; const maxIdleMs = 30000;
    const generation = state.workerGeneration;
    if (state.activeWorkerToken) throw new Error("cron worker loop already active");
    const token = {}; state.activeWorkerToken = token;
    if (state.workerPromise) state.workerCapabilityGeneration = generation;
    const active = () => state.running && state.workerGeneration === generation;
    const wait = (ms: number) => { if (state.wakePending) { state.wakePending = false; return Promise.resolve(); } return new Promise<void>((resolve) => { let done = false; const set: Set<() => void> = (state.waiters ??= new Set()); const finish = () => { if (done) return; done = true; clearTimeout(timer); set.delete(finish); resolve(); }; const timer = setTimeout(finish, Math.max(50, ms)); set.add(finish); }); };
    try {
    while (active()) {
        let claimed = false;
        while (active() && inflight.size < maxParallel) {
            const job = await ctx.fns.cron.claim({ now: Date.now() }); if (!job) break; claimed = true;
            const workerSession = Object.freeze({});
            (state.runCapabilities ??= new WeakMap()).set(workerSession, Number(job.id));
            const derived = Object.create(ctx); derived.session = workerSession;
            const promise = derived.fns.cron.runOne({ id: Number(job.id) }).catch((error: any) => ctx.fns.procs.log.error({ event: "cron.run.failed", msg: String(error?.stack ?? error), jobId: Number(job.id) })).finally(() => { state.runCapabilities.delete(workerSession); inflight.delete(promise); ctx.fns.cron.wakeWorker({}); });
            inflight.add(promise);
        }
        if (!active()) break;
        if (!claimed) { const rows = await ctx.fns.procs.db.select({ sql: "SELECT MIN(next_run_at) AS next FROM cron_tasks WHERE enabled AND state='idle' AND next_run_at IS NOT NULL" }); const next = Number((rows[0] as any)?.next ?? Date.now() + maxIdleMs); await wait(Math.min(maxIdleMs, Math.max(50, next - Date.now()))); }
    }
    } finally {
        if (inflight.size) await Promise.allSettled([...inflight]);
        if (state.activeWorkerToken === token) state.activeWorkerToken = undefined;
    }
}
