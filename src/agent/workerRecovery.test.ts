import { expect, test } from 'bun:test';
import workerLoop from './workerLoop';
import wakeWorker from './wakeWorker';

// Exercise outage recovery without a real database, model, or user workspace.
function fixture(failAt: 'settings' | 'claim' | 'idle') {
    let failed = false;
    let idleQueries = 0;
    const errors: any[] = [];
    const ctx: any = {
        state: {},
        fns: {
            agent: {
                recoverOrphanedCompactions: async () => {},
                deliverWakes: async () => {},
                pollWatches: async () => {},
                pollTriggers: async () => {},
            },
            settings: {
                getNumber: async () => {
                    if (failAt === 'settings' && !failed) {
                        failed = true;
                        throw Object.assign(new Error('database recovering'), { code: '57P03' });
                    }
                    return 0;
                },
            },
            procs: {
                log: { error: (event: any) => {
                    errors.push(event);
                    // Wake the retry wait so this test needs no real timeout.
                    wakeWorker(ctx, null);
                } },
                db: { select: async ({ sql }: any) => {
                    const claim = sql.includes('SELECT id FROM agents') && sql.includes('LIMIT 1');
                    const idle = sql.includes('SELECT LEAST(');
                    if (!failed && ((failAt === 'claim' && claim) || (failAt === 'idle' && idle))) {
                        failed = true;
                        throw Object.assign(new Error('database recovering'), { code: '57P03' });
                    }
                    if (idle) {
                        idleQueries++;
                        ctx.state.workerLoopRunning = false;
                        wakeWorker(ctx, null);
                    }
                    return [];
                } },
            },
        },
    };
    return { ctx, errors, recovered: () => failed && idleQueries > 0 };
}

for (const failAt of ['settings', 'claim', 'idle'] as const) {
    test(`worker resumes after a database outage during ${failAt}`, async () => {
        const { ctx, errors, recovered } = fixture(failAt);
        await workerLoop(ctx, null);
        expect(recovered()).toBe(true);
        expect(errors).toHaveLength(1);
        expect(errors[0].event).toBe('agent.worker.retry');
        expect(ctx.state.workerLoopRunning).toBe(false);
    });
}

test('worker retry can be stopped without starting another iteration', async () => {
    const { ctx, errors } = fixture('settings');
    ctx.fns.procs.log.error = (event: any) => {
        errors.push(event);
        ctx.state.workerLoopRunning = false;
        wakeWorker(ctx, null);
    };
    await workerLoop(ctx, null);
    expect(errors).toHaveLength(1);
    expect(ctx.state.workerLoopRunning).toBe(false);
});
