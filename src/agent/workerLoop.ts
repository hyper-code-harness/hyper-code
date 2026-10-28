// In-process worker. Drains agents whose debounce window has elapsed.
// Multiple agents run concurrently — each one is its own promise; the loop
// claims as much work as is currently pending, then sleeps for new wakes.
//
// Per-agent serialisation is enforced by the atomic claim itself:
//
//   UPDATE agents SET run_state='running' WHERE id IN (SELECT … LIMIT 1) RETURNING id
//
// Two concurrent claims targeting the same `idle` row can't both win — Postgres
// row locking on UPDATE…RETURNING ensures exactly one statement gets the id. So we never
// need an in-memory `inflight` Map keyed by agent id; the DB is the lock.
//
// State on the agents row:
//   next_run_at + run_state + last_processed_msg_idx (cursor over USER msgs)
const MAX_IDLE_MS = 30_000;
// Upper bound of one transient-failure backoff step, whatever the base setting.
const MAX_RETRY_DELAY_MS = 15 * 60_000;

function isAbortError(error: any) {
    const msg = String(error?.message ?? error ?? '');
    return msg.includes('aborted') || msg.includes('AbortError') || msg.includes('stopped_by_user') || msg.includes('shutdown');
}

async function loadAgent(ctx: Context, id: string): Promise<any> {
    let a = (ctx.state as any).agent?.[id];
    if (a) return a;
    a = (await ctx.fns.session?.load?.({ id })) ?? null;
    if (a) {
        (ctx.state as any).agent ??= {};
        (ctx.state as any).agent[id] = a;
    }
    return a;
}

function waitForWork(ctx: Context, timeoutMs: number): Promise<void> {
    // Edge-triggered: if a wake fired between the loop's "decided to sleep"
    // and this call, workerWakePending is set — return immediately, don't
    // park on the condvar. Clears the flag.
    if ((ctx.state as any).workerWakePending) {
        (ctx.state as any).workerWakePending = false;
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const set: Set<() => void> = ((ctx.state as any).workerWakeWaiters ??= new Set());
        let done = false;
        const onWake = () => { if (done) return; done = true; clearTimeout(t); set.delete(onWake); resolve(); };
        const t = setTimeout(() => { if (done) return; done = true; set.delete(onWake); resolve(); }, Math.max(0, timeoutMs));
        set.add(onWake);
    });
}

// A run owns a renewable lease. The timestamp is a heartbeat, not a total
// wall-clock limit: healthy long LLM/tool loops may run indefinitely. If the
// owning process disappears, recovery revokes its token and retries with a
// bounded exponential backoff.
const RUN_LEASE_MS = 10 * 60_000;
const RUN_HEARTBEAT_MS = 30_000;
const MAX_STALE_RETRIES = 3;

async function recoverStaleRuns(ctx: Context, now: number): Promise<void> {
    const recovered = await ctx.fns.procs.db.select({
        sql: `UPDATE agents
            SET run_state = 'idle', run_started_at = NULL,
                run_heartbeat_at = NULL, run_token = NULL,
                stale_recovery_count = stale_recovery_count + 1,
                next_run_at = CASE WHEN stale_recovery_count < ?
                    THEN ? + LEAST(120000, 5000 * CAST(power(2, stale_recovery_count) AS BIGINT))
                    ELSE NULL END,
                last_error = CASE WHEN stale_recovery_count < ?
                    THEN 'stale run recovered; automatic retry scheduled'
                    ELSE 'stale run recovered; automatic retry limit reached' END,
                updated_at = ?
          WHERE run_state = 'running'
            AND COALESCE(run_heartbeat_at, run_started_at) IS NOT NULL
            AND COALESCE(run_heartbeat_at, run_started_at) < ?
          RETURNING id`,
        params: [MAX_STALE_RETRIES, now, MAX_STALE_RETRIES, now, now - RUN_LEASE_MS],
    }) as any[];

    // In this process the revoked run may still be awaiting a tool. Cooperative
    // cancellation prevents it from continuing into another model/tool cycle.
    for (const row of recovered) {
        const live = (ctx.state as any).agent?.[row.id];
        if (live) live.currentJobId = null;
        try { live?.abortController?.abort('stale_run_recovered'); } catch {}
    }
    if (recovered.length) { try { ctx.fns.agent.wakeWorker({}); } catch {} }
}

// Atomically claim ONE pending agent. The opaque token fences heartbeat and
// finalize writes from an older owner after recovery/reclaim.
async function claimOne(ctx: Context, now: number): Promise<{ id: string; token: string } | null> {
    const token = crypto.randomUUID();
    const claimed = await ctx.fns.procs.db.select({
        sql: `UPDATE agents
            SET run_state       = 'running',
                run_started_at  = ?,
                run_heartbeat_at = ?,
                run_token       = ?,
                next_run_at     = NULL,
                last_error      = NULL,
                updated_at      = ?
          WHERE id IN (
              SELECT id FROM agents
               WHERE run_state = 'idle'
                 AND next_run_at IS NOT NULL
                 AND next_run_at <= ?
                 AND archived_at IS NULL
               ORDER BY next_run_at ASC
               LIMIT 1
          )
          RETURNING id`,
        params: [now, now, token, now, now],
    }) as any[];
    return claimed.length === 0 ? null : { id: claimed[0]!.id as string, token };
}

// The turn event: duration, tool calls and failures counted from this run's own tool_call events.
async function appendTurnEvent(ctx: Context, agentId: string, startedAt: number, endedAt: number, outcome: 'ok' | 'error' | 'stopped'): Promise<void> {
    const row = ((await ctx.fns.procs.db.select({
        sql: `SELECT count(*)::int AS tools,
                     count(*) FILTER (WHERE payload::jsonb->>'isError' = 'true')::int AS errors,
                     COALESCE(sum((payload::jsonb->>'thinkMs')::bigint), 0)::bigint AS think
                FROM events WHERE agent_id = ? AND type = 'tool_call' AND ts >= ?`,
        params: [agentId, startedAt],
    })) as any[])[0] ?? {};
    await ctx.fns.session.appendEvent({ id: agentId, event: {
        type: 'turn', startedAt, durationMs: Math.max(0, endedAt - startedAt),
        tools: Number(row.tools ?? 0), errors: Number(row.errors ?? 0), thinkMs: Number(row.think ?? 0), outcome,
    }, ts: endedAt });
}

// Run one agent end-to-end. Mirrors what the old single-agent loop body did:
// frontier snapshot → run() → finally: advance cursor / reschedule / mark idle.
async function runOne(ctx: Context, agentId: string, runToken: string): Promise<void> {
    const agent = await loadAgent(ctx, agentId);
    if (!agent) {
        const ts = Date.now();
        await ctx.fns.procs.db.run({
            sql: `UPDATE agents SET run_state = 'idle', run_started_at = NULL, run_heartbeat_at = NULL, run_token = NULL, last_error = ?, updated_at = ? WHERE id = ? AND run_token = ?`,
            params: ['agent not found at run-time', ts, agentId, runToken],
        });
        return;
    }

    // Snapshot USER-message frontier before run(). Cursor only advances on success,
    // and "did new messages arrive during the run" must mean new real user
    // messages — synthetic §result:* / §error:* user-rows are
    // excluded_from_cursor=1, assistant emissions are not 'user' role.
    const frontier = ((await ctx.fns.procs.db.select({
        sql: "SELECT COALESCE(MAX(idx), -1) AS max_idx FROM messages WHERE agent_id = ? AND role = 'user' AND excluded_from_cursor = 0",
        params: [agentId],
    })) as any[])[0];
    const frontierIdx = Number(frontier?.max_idx ?? -1);

    agent.isStreaming = true;
    agent.currentJobId = runToken;
    // The turn clock: the chat draws a "thinking" cell and the overall time from here until the turn event below.
    const turnStartedAt = Date.now();
    agent.runStartedAt = turnStartedAt;
    ctx.fns.procs.events.refresh({ topic: `agent:${agentId}`, reason: "run-start" });
    let heartbeatBusy = false;
    const heartbeat = async () => {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        try {
            const beat = Date.now();
            const touched = await ctx.fns.procs.db.run({
                sql: `UPDATE agents SET run_heartbeat_at = ? WHERE id = ? AND run_state = 'running' AND run_token = ?`,
                params: [beat, agentId, runToken],
            });
            if (!touched.changes && agent.currentJobId === runToken) {
                try { agent.abortController?.abort('run_lease_revoked'); } catch {}
            }
        } finally { heartbeatBusy = false; }
    };
    const heartbeatTimer = setInterval(() => { void heartbeat().catch(() => undefined); }, RUN_HEARTBEAT_MS);
    let errorText: string | null = null;
    let failure: types.llm.FailureInfo | null = null;
    let aborted = false;

    // Steering: run() reports the user-message frontier its LAST model call
    // actually saw — everything up to it was answered inside this run, so the
    // cursor advances to it and no duplicate pass is scheduled for it.
    let consumedIdx = frontierIdx;
    try {
        const result = await ctx.fns.agent.run({ agent, userText: '', userMessageAlreadyAppended: true });
        consumedIdx = Math.max(frontierIdx, Number((result as any)?.consumedUserIdx ?? -1));
    } catch (e: any) {
        if (agent.currentJobId !== runToken) aborted = true;
        else if (isAbortError(e)) {
            aborted = true;
        } else {
            // Stream implementations classify their own HTTP failures and carry
            // the verdict on the error. A spent subscription is a wait, not a
            // breakage: it gets parked below instead of an error badge.
            failure = (e?.failure as types.llm.FailureInfo | undefined) ?? null;
            errorText = failure?.message ?? e?.message ?? String(e);
            if (failure?.kind !== 'usage_limit') {
                try { await ctx.fns.session.appendErrorEvent({ id: agentId, error: errorText ?? 'unknown error', ts: Date.now() }); } catch {}
            }
        }
    } finally {
        clearInterval(heartbeatTimer);
        const ts = Date.now();
        const advanceCursor = !aborted && !errorText;

        // ONE atomic finalize — the read-compute-write it replaces had a race:
        // a POST landing between "read afterIdx" and "UPDATE … next_run_at=NULL"
        // had its fresh schedule wiped, and the message never ran. Claiming
        // consumes next_run_at (claimOne sets it NULL), so any value present
        // here was set by a concurrent POST and must survive; pending work with
        // no schedule gets one. Cursor advances only on success; on abort/error
        // it stays put so the same messages retry on the next user-triggered
        // pass (no auto-retry — a permanently-broken LLM call would burn the
        // worker in a loop).
        const finalized = await ctx.fns.procs.db.run({
            sql: `UPDATE agents
                SET run_state = 'idle',
                    run_started_at = NULL,
                    last_processed_msg_idx = CASE WHEN ? = 1 THEN ? ELSE last_processed_msg_idx END,
                    next_run_at = CASE
                        WHEN ? = 1 THEN
                            -- success: reschedule iff a user message exists past what
                            -- this run's LAST model call consumed (steering answered
                            -- everything up to consumedIdx inside the run); a schedule
                            -- for an already-consumed POST is cleared. A message that
                            -- commits after this snapshot re-sets next_run_at itself,
                            -- serialized after this row lock — nothing is lost.
                            CASE WHEN (SELECT COALESCE(MAX(idx), -1) FROM messages m
                                        WHERE m.agent_id = agents.id AND m.role = 'user' AND m.excluded_from_cursor = 0) > ?
                                 THEN COALESCE(next_run_at, ?)
                                 ELSE NULL END
                        -- abort/error: keep whatever schedule a concurrent POST set
                        -- (user-triggered retry); claim consumed the original one.
                        ELSE next_run_at
                    END,
                    last_error = ?,
                    stale_recovery_count = CASE WHEN ? = 1 THEN 0 ELSE stale_recovery_count END,
                    run_heartbeat_at = NULL,
                    run_token = NULL,
                    updated_at = ?
              WHERE id = ? AND run_token = ?
              RETURNING next_run_at`,
            params: [advanceCursor ? 1 : 0, consumedIdx, advanceCursor ? 1 : 0, consumedIdx, ts + 100, errorText, advanceCursor ? 1 : 0, ts, agentId, runToken],
        });

        // Recovery or an explicit stop may already have revoked this token.
        // In that case this owner is fenced: it must not schedule retries,
        // clear another run's state, or trigger post-run work.
        if (!finalized.changes) {
            if (agent.currentJobId === runToken) {
                agent.currentJobId = null;
                agent.samplingAbortController = null;
            agent.abortController = null;
                agent.isStreaming = false;
            }
            try { await ctx.fns.session.syncAgentState({ agent }); } catch {}
            return;
        }

        // TRANSIENT failures (overloaded provider, stalled stream, 5xx, dropped
        // connection) are retried automatically with exponential backoff:
        // base × 3^n (10s, 30s, 90s, … capped), never sooner than the provider's
        // Retry-After. The attempt count and base delay are settings
        // (agent.transientRetries, agent.transientRetryBaseMs). Anything else —
        // and the last failed attempt — stays manual (statusbar badge).
        //
        // A spent subscription window is never transient: retrying it costs a
        // round-trip per agent and cannot succeed before the quota resets. Such
        // a failure parks the whole credential group instead, with a durable
        // wake-up at the reset moment (see agent.parkOnUsageLimit).
        const retries: Record<string, number> = ((ctx.state as any).agentRunRetries ??= {});
        if (failure?.kind === 'usage_limit') {
            delete retries[agentId];
            try {
                await ctx.fns.agent.parkOnUsageLimit({ info: failure, originAgentId: agentId });
            } catch (error: any) {
                console.error(`parking after usage limit failed for ${agentId}:`, error?.message ?? error);
                try { await ctx.fns.session.appendErrorEvent({ id: agentId, error: errorText ?? 'usage limit', ts: Date.now() }); } catch {}
            }
        } else {
            const transient = failure
                ? failure.retryable
                : !!errorText && /stalled|overloaded|try again later|429|(?:^|\D)5\d\d(?:\D|$)|connection (?:was )?closed|ConnectionRefused|network|ETIMEDOUT|ECONNRESET|timed? ?out/i.test(errorText);
            const maxRetries = Number(await ctx.fns.settings.getNumber({ module: 'agent', scopeType: 'global', key: 'transientRetries', fallback: 4 }));
            const done = retries[agentId] ?? 0;
            if (!errorText) delete retries[agentId];
            else if (transient && done < maxRetries) {
                retries[agentId] = done + 1;
                const baseMs = Number(await ctx.fns.settings.getNumber({ module: 'agent', scopeType: 'global', key: 'transientRetryBaseMs', fallback: 10_000 }));
                const delayMs = Math.max(1_000, Number(failure?.retryAfterMs ?? 0), Math.min(baseMs * 3 ** done, MAX_RETRY_DELAY_MS));
                await ctx.fns.procs.db.run({
                    sql: 'UPDATE agents SET next_run_at = COALESCE(next_run_at, ?) WHERE id = ?',
                    params: [ts + delayMs, agentId],
                });
                try { await ctx.fns.session.appendErrorEvent({ id: agentId, error: `automatic retry ${done + 1}/${maxRetries} in ${Math.round(delayMs / 1000)}s`, ts: Date.now() }); } catch {}
            } else if (transient) {
                delete retries[agentId];
            }
        }

        if (agent.currentJobId === runToken) {
            agent.currentJobId = null;
            agent.samplingAbortController = null;
            agent.abortController = null;
            agent.isStreaming = false;
            agent.runStartedAt = null;
        }
        // One durable line per turn: how long it took and what it did. The chat draws it as the turn's total.
        try { await appendTurnEvent(ctx, agentId, turnStartedAt, ts, aborted ? 'stopped' : errorText ? 'error' : 'ok'); } catch {}
        try { await ctx.fns.session.syncAgentState({ agent }); } catch {}

        // If the agent left finalize with a schedule (pending work or a
        // concurrent POST), kick the worker so the loop notices immediately.
        const rescheduled = (finalized.rows[0] as any)?.next_run_at != null;
        if (rescheduled) { try { ctx.fns.agent.wakeWorker?.({}); } catch {} }
        // compactContext requires the finalized idle row. Run it in the
        // background so compaction cannot change the outcome of a successful turn.
        if (advanceCursor) {
            void ctx.fns.agent.autoCompactIfNeeded({ agent }).catch((error: any) => {
                ctx.fns.procs.log.warn({ event: "agent.auto-compact.failed", agentId, msg: String(error?.message ?? error) });
            });
        }
    }

}

// ONE worker per database. Two processes on the same Postgres both draining the
// queue is how an orphaned server (its supervisor gone, its port taken by the
// successor) kept claiming agents for days: it ran them on stale code, kept
// renewing the heartbeat of a run stuck in a tool, so stale-run recovery never
// fired, and the person saw an agent that "hangs" after a reminder. A session
// advisory lock on a reserved connection makes the second process a standby:
// it serves HTTP but claims nothing until the holder's connection is gone.
const WORKER_LOCK_KEY = 'hyper.agent.workerLoop';
const LOCK_CHECK_MS = 10_000;

async function holdWorkerLock(ctx: Context): Promise<boolean> {
    // Test contexts use a one-connection pool pinned to pg_temp: reserving it
    // would starve every other query, and there is no second process to fence.
    if (ctx.fns.procs.env.mode({}) === 'test') return true;
    const st = ctx.state as any;
    if (st.workerLock) {
        if (Date.now() - Number(st.workerLockCheckedAt ?? 0) < LOCK_CHECK_MS) return true;
        try {
            await st.workerLock.unsafe('SELECT 1');
            st.workerLockCheckedAt = Date.now();
            return true;
        } catch (error: any) {
            // The lock lived on that connection; whoever asks next may get it.
            console.error('[workerLoop] lock connection lost:', error?.message ?? error);
            try { st.workerLock.release(); } catch {}
            st.workerLock = null;
        }
    }
    const pool: any = await ctx.fns.procs.db.conn({});
    const reserved = await pool.reserve();
    try {
        const rows = await reserved.unsafe('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [WORKER_LOCK_KEY]);
        if (rows?.[0]?.ok) {
            st.workerLock = reserved;
            st.workerLockCheckedAt = Date.now();
            st.workerStandbyLogged = false;
            ctx.fns.procs.log.info({ event: 'agent.worker.lock', msg: `agent worker lock acquired (pid ${process.pid})` });
            return true;
        }
    } catch (error: any) {
        console.error('[workerLoop] lock attempt failed:', error?.message ?? error);
    }
    try { reserved.release(); } catch {}
    if (!st.workerStandbyLogged) {
        st.workerStandbyLogged = true;
        ctx.fns.procs.log.warn({ event: 'agent.worker.standby', msg: 'another process on this database runs the agent worker — standing by' });
    }
    return false;
}

async function releaseWorkerLock(ctx: Context): Promise<void> {
    const st = ctx.state as any;
    const reserved = st.workerLock;
    st.workerLock = null;
    if (!reserved) return;
    try { await reserved.unsafe('SELECT pg_advisory_unlock(hashtext($1))', [WORKER_LOCK_KEY]); } catch {}
    try { reserved.release(); } catch {}
}

/** Worker loop for the runtime. */
// One pass of the worker: hold the lock, run housekeeping, claim and start every due agent, then sleep
// until the next due time or a wake. Throws on database errors; the loop above retries.
async function workerPass(ctx: Context, inflight: Set<Promise<unknown>>): Promise<void> {
        if (!(await holdWorkerLock(ctx).catch(() => false))) {
            await waitForWork(ctx, 5_000);
            return;
        }
        // Drain every claimable agent into a parallel promise. The atomic
        // claim guarantees no two concurrent runs target the same agent.
        // No artificial concurrency cap — backpressure comes from the LLM
        // provider (429 / connection errors) and Postgres serialising row writes.
        let drained = 0;
        await recoverStaleRuns(ctx, Date.now()).catch(() => undefined);
        await (ctx.fns.agent as any).recoverOrphanedCompactions({}).catch((error: any) => console.error('compaction recovery failed:', error));
        const lastTeamArchiveScan = Number((ctx.state as any).lastTeamArchiveScan ?? 0);
        await ctx.fns.jobs.poll({ now: Date.now() }).catch((error: any) => console.error('job polling failed:', error));
        if (Date.now() - lastTeamArchiveScan >= 10_000) {
            (ctx.state as any).lastTeamArchiveScan = Date.now();
            const archiveAfterMs = await ctx.fns.settings.getNumber({ module: 'agent', scopeType: 'global', key: 'teamArchiveAfterMs', fallback: 60_000 });
            if (Number(archiveAfterMs) > 0) {
                await ctx.fns.agent.archiveCompleted({ olderThanMs: Number(archiveAfterMs) }).catch((error: any) => console.error('team archive scan failed:', error));
            }
        }
        while (true) {
            const claim = await claimOne(ctx, Date.now());
            if (!claim) break;
            drained++;
            const p = runOne(ctx, claim.id, claim.token).finally(() => {
                inflight.delete(p);
                // A completion changes claimability (the agent becomes idle and
                // may leave pending work). Wake the parked loop immediately;
                // otherwise another agent can sit scheduled for MAX_IDLE_MS.
                try { ctx.fns.agent.wakeWorker({}); } catch {}
            });
            inflight.add(p);
        }

        if (inflight.size === 0) {
            // No work in flight. Sleep until either a wake signal lands or
            // the soonest scheduled `next_run_at` is due.
            const next = ((await ctx.fns.procs.db.select({
                sql: `SELECT LEAST(
                        COALESCE((SELECT MIN(next_run_at) FROM agents WHERE run_state = ? AND next_run_at IS NOT NULL AND archived_at IS NULL), ?),
                        COALESCE((SELECT MIN(next_at) FROM jobs WHERE status = 'running'), ?)
                      ) AS next`,
                params: ['idle', Date.now() + MAX_IDLE_MS, Date.now() + MAX_IDLE_MS],
            })) as any[])[0];
            const nextMs = next?.next ? Number(next.next) - Date.now() : MAX_IDLE_MS;
            const wait = Math.max(50, Math.min(MAX_IDLE_MS, nextMs));
            await waitForWork(ctx, wait);
        } else if (drained === 0) {
            // Runs are in flight but no new claims this cycle. A different idle
            // agent may already be scheduled a few milliseconds ahead, so wait
            // for the earlier of a wake and the next due time — never a blind
            // MAX_IDLE_MS sleep that accidentally serialises agents.
            const next = ((await ctx.fns.procs.db.select({
                sql: `SELECT LEAST(
                        COALESCE((SELECT MIN(next_run_at) FROM agents WHERE run_state = ? AND next_run_at IS NOT NULL AND archived_at IS NULL), ?),
                        COALESCE((SELECT MIN(next_at) FROM jobs WHERE status = 'running'), ?)
                      ) AS next`,
                params: ['idle', Date.now() + MAX_IDLE_MS, Date.now() + MAX_IDLE_MS],
            })) as any[])[0];
            const nextMs = next?.next ? Number(next.next) - Date.now() : MAX_IDLE_MS;
            await waitForWork(ctx, Math.max(50, Math.min(MAX_IDLE_MS, nextMs)));
        }
        // else: drained > 0 — loop back immediately to look for more.
    }

export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<void> {
    if ((ctx.state as any).workerLoopRunning) return;
    (ctx.state as any).workerLoopRunning = true;

    const inflight = new Set<Promise<unknown>>();

    let failures = 0;
    while ((ctx.state as any).workerLoopRunning) {
        // One failed pass (a dropped connection, Postgres "out of shared memory") must not end the
        // worker: it used to throw out of this loop, leaving workerLoopRunning true and every agent
        // silently queued until a restart. Log, back off, try again.
        try {
            await workerPass(ctx, inflight);
            failures = 0;
        } catch (error: any) {
            failures++;
            const delay = Math.min(30_000, 500 * 2 ** Math.min(failures, 6));
            console.error(`[workerLoop] pass failed (${failures}), retrying in ${delay}ms:`, error?.message ?? error);
            ctx.fns.procs.log.warn({ event: 'agent.worker.passFailed', msg: String(error?.message ?? error) });
            await waitForWork(ctx, delay);
        }
    }

    // Graceful shutdown: don't return while runOne finalizers still have
    // in-flight DB writes — callers (and test afterAll pool close) rely on
    // the loop promise resolving only after all claimed work has settled.
    if (inflight.size > 0) await Promise.allSettled([...inflight]);
    await releaseWorkerLock(ctx);
}
