import { test, expect, describe } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

describe('GET /agent/:id', () => {
    test('404 when agent does not exist', async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: '/agent/nope' });
        expect(res.status).toBe(404);
    });

    test('loads agent from session storage when missing from runtime state', async () => {
        const ctx = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'db-model', systemPrompt: '' });
        await ctx.fns.session.save({ agent });
        delete (ctx.state as any).agent?.[agent.id]; // force the session.load path

        const res = await ctx.fns.procs.http.dispatch({ url: '/agent/' + agent.id });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect((ctx.state as any).agent[agent.id]).toBeTruthy();
        expect(html).toContain(agent.id);
        expect(html).toContain('db-model');
    });

    test('renders the provider icon as a model-picker trigger', async () => {
        const ctx: any = await mkTestCtx();
        const agent = await ctx.fns.agent.start({ model: 'mock:test', systemPrompt: '' });
        await ctx.fns.session.save({ agent });

        const res = await ctx.fns.procs.http.dispatch({ url: '/agent/' + agent.id });
        const html = await res.text();
        expect(html).toContain('hx-popup="agent.modelPicker"');
        expect(html).toContain('Change model: mock:test');
    });

});
