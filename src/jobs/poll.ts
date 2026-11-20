/**
 * Checks due background jobs and finishes the ones that ended, timed out or vanished
 *
 * Called by the agent worker loop on every pass. Claims due running jobs with a short lease (so two workers never
 * probe the same job), probes bash jobs in their tmux session, runs due wake-ups, cron schedules
 * and watches (jobs.tickSchedule), enforces deadlines and honours cancel requests, then calls jobs.finish which
 * messages the agent. Unreachable SSH hosts are retried with backoff
 * and reported as lost only after their deadline.
 * @param opts.now Timestamp in ms; defaults to now.
 * @param opts.limit Maximum jobs per pass. @default 20
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Timestamp in ms; defaults to now. */
        now?: number;
        /** Maximum jobs per pass. @default 20 @minimum 1 @maximum 100 */
        limit?: number;
    },
): Promise<{ checked: string[]; finished: string[] }> {
    const now = Math.floor(opts?.now ?? Date.now());
    const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 20)));
    const token = Bun.randomUUIDv7();
    const due = await ctx.fns.procs.db.select({
        sql: `UPDATE jobs SET lease_token = ?, lease_expires_at = ?, updated_at = ?
               WHERE id IN (SELECT id FROM jobs WHERE status = 'running' AND runner <> 'compaction' AND next_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at < ?) ORDER BY next_at LIMIT ? FOR UPDATE SKIP LOCKED)
               RETURNING *`,
        params: [token, now + 60_000, now, now, now, limit],
    }) as any[];
    const checked: string[] = [];
    const finished: string[] = [];
    // Probes run in parallel; finishes are collected and committed afterwards, so each
    // completion message knows which jobs of this pass also ended.
    const endings: Array<Parameters<typeof ctx.fns.jobs.finish>[0]> = [];
    await Promise.all(due.map(async (row) => {
        const id = String(row.id);
        checked.push(id);
        const spec = typeof row.spec === "string" ? JSON.parse(row.spec) : row.spec ?? {};
        const state = typeof row.state === "string" ? JSON.parse(row.state) : row.state ?? {};
        const age = now - Number(row.started_at ?? row.created_at);
        const done = async (o: Parameters<typeof ctx.fns.jobs.finish>[0]) => { endings.push(o); };
        const reschedule = async (nextAt: number, patch: Record<string, any> = {}) => ctx.fns.procs.db.run({
            sql: "UPDATE jobs SET next_at = ?, lease_token = NULL, lease_expires_at = NULL, state = ?::jsonb, updated_at = ? WHERE id = ? AND lease_token = ?",
            params: [nextAt, JSON.stringify({ ...state, ...patch }), now, id, token],
        });
        try {
            if (row.runner === "at" || row.runner === "cron" || row.runner === "watch") {
                // Schedules commit their own prompt + state + audit in one transaction.
                await ctx.fns.jobs.tickSchedule({ row, token, now });
                return;
            }
            if (row.runner !== "bash" && row.runner !== "attached") return await done({ id, status: "failed", reason: `unknown runner ${row.runner}`, now });
            // "attached": a foreground call moved to the background; the process is a child of this
            // server, alive only while it holds the kill handle (gone after a restart).
            const probe = row.runner === "attached"
                ? await ctx.fns.jobs.bashProbe({ jobId: id, host: null, alive: ((ctx.state as any).attachedJobs as Map<string, unknown> | undefined)?.has(id) ?? false })
                : await ctx.fns.jobs.bashProbe({ jobId: id, host: spec.host ?? null, backend: spec.backend });
            const tail = await ctx.fns.jobs.redact({ spec, text: probe.tail });
            if (probe.state === "done") {
                const status = row.cancel_requested_at != null ? "cancelled" : probe.exitCode === 0 ? "succeeded" : "failed";
                return await done({ id, status, reason: status === "cancelled" ? "cancelled" : "exit", exitCode: probe.exitCode, tail, bytes: probe.bytes, notify: status !== "cancelled", now });
            }
            if (probe.state === "gone") {
                const cancelled = row.cancel_requested_at != null;
                return await done({ id, status: cancelled ? "cancelled" : "lost", reason: cancelled ? "cancelled" : "gone", tail, bytes: probe.bytes, notify: !cancelled, now });
            }
            if (probe.state === "unreachable") {
                if (now >= Number(row.deadline_at)) return await done({ id, status: "lost", reason: "unreachable", now });
                const misses = Number(state.misses ?? 0) + 1;
                return await reschedule(now + Math.min(300_000, 5_000 * 2 ** Math.min(6, misses)), { misses, lastError: probe.error });
            }
            // running
            if (now >= Number(row.deadline_at)) {
                if (row.runner === "attached") ((ctx.state as any).attachedJobs as Map<string, { kill: () => void }> | undefined)?.get(id)?.kill();
                else await ctx.fns.jobs.bashKill({ jobId: id, host: spec.host ?? null, backend: spec.backend });
                const after = await ctx.fns.jobs.bashProbe({ jobId: id, host: spec.host ?? null, backend: spec.backend });
                return await done({ id, status: "timeout", reason: "timeout", exitCode: after.exitCode, tail: await ctx.fns.jobs.redact({ spec, text: after.tail || probe.tail }), bytes: after.bytes || probe.bytes, now });
            }
            // Fast at first (short commands report within ~1 s), then every 5 s.
            return await reschedule(now + (age < 10_000 ? 1_000 : age < 60_000 ? 2_000 : 5_000), { misses: 0 });
        } catch (error: any) {
            await ctx.fns.procs.log.warn({ event: "jobs.poll.failed", msg: String(error?.message ?? error), jobId: id });
            const schedule = row.runner === "at" || row.runner === "cron" || row.runner === "watch";
            await reschedule(now + 10_000, { lastError: String(error?.message ?? error).slice(0, 500), ...(schedule ? { occurrence: state.occurrence ?? Number(row.next_at) } : {}) }).catch(() => undefined);
        }
    }));
    const ending = endings.map((e) => e.id);
    for (const e of endings) {
        try {
            if ((await ctx.fns.jobs.finish({ ...e, alsoFinishing: ending.filter((id) => id !== e.id) })).finished) finished.push(e.id);
        } catch (error: any) {
            // Lease is still held: the job is re-probed after the lease expires.
            await ctx.fns.procs.log.warn({ event: "jobs.finish.failed", msg: String(error?.message ?? error), jobId: e.id });
        }
    }
    return { checked, finished };
}
