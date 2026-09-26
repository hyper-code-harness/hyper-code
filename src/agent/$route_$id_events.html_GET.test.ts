import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

async function mkAgent(ctx: any) {
    const agent = await ctx.fns.agent.start({ model: 'm', systemPrompt: '' });
    await ctx.fns.session.save({ agent });
    return agent;
}

describe('GET /agent/:id/events.html', () => {
    test('404 for unknown agent', async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: '/agent/nope/events.html?offset=0' });
        expect(res.status).toBe(404);
    });

    test('returns events at offset and a tail with next offset', async () => {
        const ctx = await mkTestCtx();
        const a = await mkAgent(ctx);
        await ctx.fns.session.appendEvent({ id: a.id, event: { type: 'user', text: 'hi', html: '<div data-ev="user">hi</div>' } });
        await ctx.fns.session.appendEvent({ id: a.id, event: { type: 'user', text: 'two', html: '<div data-ev="user">two</div>' } });

        const res = await ctx.fns.procs.http.dispatch({ url: `/agent/${a.id}/events.html?offset=0` });
        const body = await res.text();
        // user events are re-rendered (timestamps rode in with agent co's
        // feature) — assert content, not the seeded cached markup
        expect(body).toContain('>hi<');
        expect(body).toContain('>two<');
        expect(body).toContain('id="msg-tail"');
        expect(body).toContain(`offset=2`);
    });

    test('returns only delta when offset is in the middle', async () => {
        const ctx = await mkTestCtx();
        const a = await mkAgent(ctx);
        await ctx.fns.session.appendEvent({ id: a.id, event: { type: 'user', text: 'a', html: '<div>a</div>' } });
        await ctx.fns.session.appendEvent({ id: a.id, event: { type: 'user', text: 'b', html: '<div>b</div>' } });
        await ctx.fns.session.appendEvent({ id: a.id, event: { type: 'user', text: 'c', html: '<div>c</div>' } });

        const res = await ctx.fns.procs.http.dispatch({ url: `/agent/${a.id}/events.html?offset=2` });
        const body = await res.text();
        expect(body).toContain('>c<');
        expect(body).not.toContain('>a<');
        expect(body).not.toContain('>b<');
        expect(body).toContain('offset=3');
    });

    test('returns instantly with empty delta + tail (no long-poll)', async () => {
        // The route is a short fetch. The shared SSE live-region client is the
        // normal trigger; the 30s interval is only a watchdog.
        const ctx = await mkTestCtx();
        const a = await mkAgent(ctx);

        const t0 = Date.now();
        const res = await ctx.fns.procs.http.dispatch({ url: `/agent/${a.id}/events.html?offset=0` });
        const wall = Date.now() - t0;
        expect(wall).toBeLessThan(50);

        const body = await res.text();
        expect(body).toContain('id="msg-tail"');
        // A standard live region: the shared stream invalidates agent:a and
        // the interval only repairs a missed signal.
        expect(body).toContain('hx-trigger="hyper-live, every');
        expect(body).toContain('data-live-topic="agent:a"');
        expect(body).toContain('every 30s');
        expect(body).toContain('offset=0');
    });
    test('pages older events backwards without returning a live tail', async () => {
        const ctx = await mkTestCtx();
        const a = await mkAgent(ctx);
        for (let i = 0; i < 7; i++) {
            await ctx.fns.session.appendEvent({ id: a.id, event: { type: 'user', text: `event-${i}` } });
        }

        const res = await ctx.fns.procs.http.dispatch({ url: `/agent/${a.id}/events.html?before=6&limit=3` });
        const body = await res.text();
        expect(body).toContain('event-3');
        expect(body).toContain('event-4');
        expect(body).toContain('event-5');
        expect(body).not.toContain('event-2');
        expect(body).not.toContain('event-6');
        expect(body).toContain('id="msg-head"');
        expect(body).toContain('before=3');
        expect(body).not.toContain('id="msg-tail"');
    });


});
