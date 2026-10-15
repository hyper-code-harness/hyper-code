import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';
import workerLoop from './workerLoop';
import wakeWorker from './wakeWorker';

// Insert an agents row directly so we don't depend on agent.start (which would
// also call session.save and set next_run_at = NULL). We want full control of
// next_run_at to drive the worker.
async function seedReadyAgent(ctx: any, id: string, nextRunAt: number) {
    const ts = Date.now();
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO agents (id, model, system_prompt, scratchpad, created_at, updated_at, next_run_at, run_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [id, 'mock:test', '', '{}', ts, ts, nextRunAt, 'idle'],
    });
    (ctx.state as any).agent ??= {};
    (ctx.state as any).agent[id] = {
        id, model: 'mock:test', systemPrompt: '', scratchpad: {},
        messages: [], events: [], cursors: {}, subscribers: new Set(),
        waiters: [], isStreaming: false, abortController: null,
        parentId: null, forkOffset: null,
    };
}

describe('agent.workerLoop', () => {
    test('drains multiple ready agents concurrently (intervals overlap)', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;

        const past = Date.now() - 100;
        for (const id of ['p1', 'p2', 'p3']) await seedReadyAgent(ctx, id, past);

        // Each run() takes ~100ms. Serial worker would land 3×100ms = ~300ms
        // of intervals end-to-end with no overlap. Parallel worker fires all
        // three at once; intervals overlap heavily.
        const intervals: { id: string; start: number; end: number }[] = [];
        ctx.fns.agent.run = async (_c: any, _s: any, opts: any) => {
            const start = Date.now();
            await Bun.sleep(100);
            intervals.push({ id: opts.agent.id, start, end: Date.now() });
        };

        const loopPromise = workerLoop(ctx, null);

        // Wait until run() fired for every agent.
        const deadline = Date.now() + 2_000;
        while (intervals.length < 3 && Date.now() < deadline) await Bun.sleep(10);

        // Stop the loop and let it observe the flag flip on the next wake.
        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loopPromise;

        expect(intervals).toHaveLength(3);

        // Verify at least one pair overlaps in time.
        let overlapping = 0;
        for (let i = 0; i < intervals.length; i++) {
            for (let j = i + 1; j < intervals.length; j++) {
                const a = intervals[i]!, b = intervals[j]!;
                if (a.start < b.end && b.start < a.end) overlapping++;
            }
        }
        expect(overlapping).toBeGreaterThan(0);

        // Wall-clock total should be far less than the serial sum.
        const totalSpan = Math.max(...intervals.map(i => i.end)) - Math.min(...intervals.map(i => i.start));
        expect(totalSpan).toBeLessThan(250); // 3 × 100ms = 300ms serial; parallel ≈ 100–150ms
    }, 5_000);

    test('a database error in one pass does not end the worker: it retries and still runs queued agents', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;
        await seedReadyAgent(ctx, 'r1', Date.now() - 100);
        const ran: string[] = [];
        ctx.fns.agent.run = async (_c: any, _s: any, opts: any) => { ran.push(opts.agent.id); };
        // The first housekeeping call throws outside its own .catch, like a lost connection or
        // "out of shared memory" from Postgres did in production.
        let calls = 0;
        const realSettings = ctx.fns.settings.getNumber;
        ctx.fns.settings.getNumber = async (o: any) => { if (++calls === 1) throw new Error('out of shared memory'); return realSettings(o); };
        const loopPromise = workerLoop(ctx, null);
        const deadline = Date.now() + 4_000;
        while (!ran.length && Date.now() < deadline) await Bun.sleep(20);
        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loopPromise;
        expect(calls).toBeGreaterThan(1);
        expect(ran).toEqual(['r1']);
    }, 8_000);

    test('atomic claim prevents two concurrent claims of the same agent', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;

        const past = Date.now() - 100;
        await seedReadyAgent(ctx, 'lonely', past);

        // Track how many times run() actually fires for this agent.
        let runCount = 0;
        ctx.fns.agent.run = async () => {
            runCount++;
            await Bun.sleep(50);
        };

        // Spawn TWO worker loops back to back (simulates two would-be
        // claimants). The DB-level atomic claim should give the agent to
        // exactly one of them; the other observes claimed.length === 0 and
        // sleeps. (Second invocation also returns immediately because of the
        // workerLoopRunning guard, so this also tests that guard.)
        const a = workerLoop(ctx, null);
        const b = workerLoop(ctx, null);

        const deadline = Date.now() + 2_000;
        while (runCount < 1 && Date.now() < deadline) await Bun.sleep(10);
        await Bun.sleep(150); // give a possible second claim time to (not) happen

        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await Promise.all([a, b]);

        expect(runCount).toBe(1);
    }, 5_000);

    test('drains 20 agents under 250ms wall-clock (parallelism scales)', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;

        const past = Date.now() - 100;
        const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
        for (const id of ids) await seedReadyAgent(ctx, id, past);

        const intervals: { id: string; start: number; end: number }[] = [];
        ctx.fns.agent.run = async (_c: any, _s: any, opts: any) => {
            const start = Date.now();
            await Bun.sleep(100);
            intervals.push({ id: opts.agent.id, start, end: Date.now() });
        };

        const t0 = Date.now();
        const loopPromise = workerLoop(ctx, null);

        const deadline = Date.now() + 5_000;
        while (intervals.length < ids.length && Date.now() < deadline) await Bun.sleep(10);

        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loopPromise;
        const wall = Date.now() - t0;

        expect(intervals).toHaveLength(ids.length);
        // Serial would be ≥ 20 × 100ms = 2s. Parallel should land ≤ 250ms
        // (drain claim overhead + ~100ms run + a couple of awaits).
        expect(wall).toBeLessThan(250);
    }, 10_000);

    test('wakeWorker fired before waitForWork is observed (no slept-through race)', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;

        // Set the wake flag BEFORE anyone is waiting. Old behaviour:
        // wakeWorker walks an empty Set, drops the wake on the floor, and
        // the next waitForWork sleeps until the safety poll fires.
        wakeWorker(ctx, null);

        // Run a run-less workerLoop turn: no claimable agents, so it would
        // immediately fall into waitForWork. With edge-triggered wake the
        // flag short-circuits the wait and the loop exits when we flip
        // workerLoopRunning=false right after.
        const t0 = Date.now();
        const loopPromise = workerLoop(ctx, null);
        // give the loop a chance to enter waitForWork once
        await Bun.sleep(20);
        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loopPromise;
        const wall = Date.now() - t0;

        // Must finish well under any safety timeout (MAX_IDLE_MS = 30s).
        // If the pre-wait wake had been lost we'd see ~30 s here.
        expect(wall).toBeLessThan(500);
    }, 5_000);

    test('aborted run leaves cursor untouched and does not auto-reschedule', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;

        const past = Date.now() - 100;
        await seedReadyAgent(ctx, 'aborter', past);
        // Append a real user message so we have a frontier > -1.
        await ctx.fns.session.appendMessage({ id: 'aborter', message: { role: 'user', content: 'hi' } });
        const beforeCursor = (await ctx.fns.procs.db.select({
            sql: 'SELECT last_processed_msg_idx FROM agents WHERE id = ?',
            params: ['aborter'],
        }))[0].last_processed_msg_idx;

        ctx.fns.agent.run = async () => { throw new Error('aborted by user'); };

        const loopPromise = workerLoop(ctx, null);
        await Bun.sleep(150);
        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loopPromise;

        const row = (await ctx.fns.procs.db.select({
            sql: 'SELECT run_state, next_run_at, last_processed_msg_idx FROM agents WHERE id = ?',
            params: ['aborter'],
        }))[0];
        expect(row.run_state).toBe('idle');
        expect(row.next_run_at).toBeNull();                       // not rescheduled
        expect(row.last_processed_msg_idx).toBe(beforeCursor);    // cursor preserved
    }, 5_000);
    test('claims a second agent when it becomes due during another run', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;

        const now = Date.now();
        await seedReadyAgent(ctx, 'already', now - 10);
        await seedReadyAgent(ctx, 'soon', now + 120);

        const started: Record<string, number> = {};
        ctx.fns.agent.run = async (_c: any, _s: any, opts: any) => {
            started[opts.agent.id] = Date.now();
            await Bun.sleep(opts.agent.id === 'already' ? 350 : 30);
        };

        const loopPromise = workerLoop(ctx, null);
        const deadline = Date.now() + 2_000;
        while (!started.soon && Date.now() < deadline) await Bun.sleep(10);

        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loopPromise;

        expect(started.already).toBeDefined();
        expect(started.soon).toBeDefined();
        expect(started.soon! - started.already!).toBeLessThan(300);
    }, 5_000);
});



describe('agent.workerLoop renewable lease', () => {
    test('healthy runs longer than the old 10-minute wall clock are not reclaimed', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;
        const now = Date.now();
        await seedReadyAgent(ctx, 'lh', now - 11 * 60_000);
        await ctx.fns.procs.db.run({
            sql: `UPDATE agents SET run_state = 'running', next_run_at = NULL, run_started_at = ?, run_heartbeat_at = ?, run_token = ? WHERE id = ?`,
            params: [now - 11 * 60_000, now, 'healthy-token', 'lh'],
        });

        const loop = workerLoop(ctx, null);
        await Bun.sleep(30);
        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loop;

        const [row] = await ctx.fns.procs.db.select({ sql: `SELECT run_state, run_token, last_error FROM agents WHERE id = ?`, params: ['lh'] });
        expect(row.run_state).toBe('running');
        expect(row.run_token).toBe('healthy-token');
        expect(row.last_error).toBeNull();
    });

    test('expired heartbeat is fenced and scheduled with backoff', async () => {
        const ctx: any = await mkTestCtx();
        ctx.fns.agent.workerLoop = workerLoop;
        ctx.fns.agent.wakeWorker = wakeWorker;
        const now = Date.now();
        await seedReadyAgent(ctx, 'ls', now - 11 * 60_000);
        await ctx.fns.procs.db.run({
            sql: `UPDATE agents SET run_state = 'running', next_run_at = NULL, run_started_at = ?, run_heartbeat_at = ?, run_token = ? WHERE id = ?`,
            params: [now - 11 * 60_000, now - 11 * 60_000, 'stale-token', 'ls'],
        });

        const loop = workerLoop(ctx, null);
        await Bun.sleep(30);
        (ctx.state as any).workerLoopRunning = false;
        wakeWorker(ctx, null);
        await loop;

        const [row] = await ctx.fns.procs.db.select({ sql: `SELECT run_state, run_token, run_heartbeat_at, next_run_at, stale_recovery_count, last_error FROM agents WHERE id = ?`, params: ['ls'] });
        expect(row.run_state).toBe('idle');
        expect(row.run_token).toBeNull();
        expect(row.run_heartbeat_at).toBeNull();
        expect(Number(row.next_run_at)).toBeGreaterThan(now);
        expect(Number(row.stale_recovery_count)).toBe(1);
        expect(row.last_error).toContain('automatic retry scheduled');
    });
});
