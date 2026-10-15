import { describe, expect, test } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';
import cleanup from './$migration_20330306120000_remove_legacy_scratchpad_results';
import startAgents from '../agent/$start';
import startMigrations from '../procs/migrate/$start';

const migrationId = '20330306120000_remove_legacy_scratchpad_results';
async function seed(ctx: any, id: string, scratchpad: string) {
    await ctx.fns.procs.db.run({
        sql: 'INSERT INTO agents (id, model, scratchpad, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        params: [id, 'test', scratchpad, 1, 1],
    });
}
async function rows(ctx: any) {
    return await ctx.fns.procs.db.select({ sql: 'SELECT id, scratchpad, updated_at FROM agents ORDER BY id' });
}

describe('boot-only legacy scratchpad cleanup (isolated Postgres)', () => {
    test('removes only two top-level keys, preserves plans/flags/precision and skips invalid/non-objects byte-for-byte; replay is harmless', async () => {
        const ctx = await mkTestCtx();
        expect(new URL(ctx.env.DATABASE_URL).pathname).toContain('hyper_test_');
        const unchanged = ['{}', ' { "plan": {"title":"keep"}, "flag":true } ', '{broken', 'null', '[{"results":"keep"}]', '"text"', '42', 'true', '', '{"results":1,"other":"\\u0000"}'];
        for (const [i, value] of unchanged.entries()) await seed(ctx, `skip${i}`, value);
        await seed(ctx, 'both', '{"results":{"r1":"large"},"resultSeq":9,"plan":{"title":"keep","results":"nested"},"planHistory":[1],"flag":true,"n":9007199254740993}');
        await seed(ctx, 'results', '{"results":null,"flag":false}');
        await seed(ctx, 'seq', '{"resultSeq":0,"note":"keep"}');
        await seed(ctx, 'only', '{"results":[],"resultSeq":1}');
        await cleanup.up(ctx);
        const first = await rows(ctx);
        const byId = Object.fromEntries(first.map((r: any) => [r.id, r.scratchpad]));
        unchanged.forEach((value, i) => expect(byId[`skip${i}`]).toBe(value));
        expect(byId.both).toContain('9007199254740993');
        const kept = JSON.parse(byId.both);
        expect(kept.results).toBeUndefined();
        expect(kept.resultSeq).toBeUndefined();
        expect(kept.plan).toEqual({ title: 'keep', results: 'nested' });
        expect(kept.planHistory).toEqual([1]);
        expect(kept.flag).toBe(true);
        expect(JSON.parse(byId.results)).toEqual({ flag: false });
        expect(JSON.parse(byId.seq)).toEqual({ note: 'keep' });
        expect(JSON.parse(byId.only)).toEqual({});
        expect(first.every((r: any) => Number(r.updated_at) === 1)).toBe(true);
        await cleanup.up(ctx);
        expect(await rows(ctx)).toEqual(first);
    });

    test('statement failure rolls back every earlier row update', async () => {
        const ctx = await mkTestCtx();
        await seed(ctx, 'first', '{"results":1,"plan":true}');
        await seed(ctx, 'second', '{"results":2,"plan":true}');
        await ctx.fns.procs.db.exec({ sql: `CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'second' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$;
CREATE TRIGGER reject_cleanup BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION reject_cleanup();` });
        const before = await rows(ctx);
        try {
            await expect(cleanup.up(ctx)).rejects.toThrow('test rollback');
            expect(await rows(ctx)).toEqual(before);
        } finally {
            await ctx.fns.procs.db.exec({ sql: 'DROP TRIGGER reject_cleanup ON agents; DROP FUNCTION reject_cleanup()' });
        }
    });

    test('rejects manual cleanup after agents, worker or HTTP have started, without writing', async () => {
        const ctx = await mkTestCtx();
        await seed(ctx, 'legacy', '{"results":"keep while live"}');
        const before = await rows(ctx);
        for (const module of ['agent', 'procs/http']) {
            ctx.state.procs.lifecycle = { started: [module], failed: {} };
            await expect(cleanup.up(ctx)).rejects.toThrow('boot-only');
        }
        ctx.state.procs.lifecycle = { started: [], failed: {} };
        ctx.state.agent = { live: {} };
        await expect(cleanup.up(ctx)).rejects.toThrow('boot-only');
        ctx.state.agent = {};
        ctx.state.workerLoopPromise = Promise.resolve();
        await expect(cleanup.up(ctx)).rejects.toThrow('boot-only');
        expect(await rows(ctx)).toEqual(before);
    });

    test('real lifecycle order runs migration before loadAll and worker; migration marker prevents replay', async () => {
        const ctx = await mkTestCtx();
        const order = await ctx.fns.procs.lifecycle.order({});
        expect(order.indexOf('procs/db')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('procs/migrate')).toBeGreaterThan(order.indexOf('procs/db'));
        expect(order.indexOf('agent')).toBeGreaterThan(order.indexOf('procs/migrate'));
        expect(order.indexOf('procs/http')).toBeGreaterThan(order.indexOf('agent'));
        await seed(ctx, 'boot', '{"results":"old","resultSeq":1,"plan":{"title":"survives"}}');
        await ctx.fns.procs.db.run({ sql: 'DELETE FROM _migrations WHERE id = ?', params: [migrationId] });
        ctx.state.procs.migrate.list = [{ id: migrationId, up: cleanup.up }];
        const calls: string[] = [];
        const load = ctx.state.registry.session.loadAll;
        ctx.state.registry.session.loadAll = async (c: any, s: any, o: any) => {
            calls.push('load');
            expect(JSON.parse((await rows(ctx))[0].scratchpad)).toEqual({ plan: { title: 'survives' } });
            return await load(c, s, o);
        };
        ctx.state.registry.agent.workerLoop = async () => { calls.push('worker'); };
        ctx.state.registry.agent.startAttachments = async () => {};
        await startMigrations(ctx, null);
        calls.push('migrated');
        await startAgents(ctx, null);
        await Promise.resolve();
        expect(calls).toEqual(['migrated', 'load', 'worker']);
        expect((await ctx.fns.procs.migrate.up({})).applied).toEqual([]);
        expect(ctx.state.agent.boot.scratchpad).toEqual({ plan: { title: 'survives' } });
    });
});
