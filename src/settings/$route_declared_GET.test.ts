import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

describe('GET/POST /settings/declared', () => {
    test('GET renders form with all declared settings', async () => {
        const ctx = await mkTestCtx();
        const res = await ctx.fns.procs.http.dispatch({ url: '/settings/declared' });
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('declared settings');
        expect(body).toContain('lmstudioBaseUrl');
        expect(body).toContain('defaultModel');
        expect(body).toContain('debounceMs');
        expect(body).toContain('hx-post="/settings/declared"');
    });

    test('source badges in GET output match resolution chain', async () => {
        const ctx = await mkTestCtx();
        ctx.env.LMSTUDIO_URL = 'http://env-host:1234';
        await ctx.fns.settings.set({
            module: 'llm', scopeType: 'global', key: 'defaultModel', value: 'kimi:k2',
        });

        const res = await ctx.fns.procs.http.dispatch({ url: '/settings/declared' });
        const body = await res.text();
        // env-sourced
        expect(body).toMatch(/env: LMSTUDIO_URL/);
        // db-sourced
        expect(body).toMatch(/>db</);
    });

    test('POST writes form values via settings.set', async () => {
        const ctx = await mkTestCtx();
        const fd = new FormData();
        fd.set('llm.defaultModel', 'openai:gpt-4o-mini');
        fd.set('agent.debounceMs', '1500');

        const res = await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/settings/declared', body: fd });
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('settings-form');

        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('openai:gpt-4o-mini');
        expect(await ctx.fns.settings.get({ module: 'agent', scopeType: 'global', key: 'debounceMs' }))
            .toBe(1500);
    });

    test('POST with reset=<key> removes the row', async () => {
        const ctx = await mkTestCtx();
        await ctx.fns.settings.set({
            module: 'llm', scopeType: 'global', key: 'defaultModel', value: 'kimi:k2',
        });
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('kimi:k2');

        const fd = new FormData();
        fd.set('reset', 'llm.defaultModel');
        await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/settings/declared', body: fd });

        // Now falls back to declared default.
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('claude-code:claude-opus-5');
    });

    test('POST validates enum and silently ignores bad values', async () => {
        const ctx = await mkTestCtx();
        const fd = new FormData();
        fd.set('llm.defaultModel', 'made-up-model-not-in-options');
        await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/settings/declared', body: fd });

        // Bad enum was rejected — value stays at default.
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('claude-code:claude-opus-5');
    });

    test('POST validates number bounds and ignores NaN', async () => {
        const ctx = await mkTestCtx();
        const fd = new FormData();
        fd.set('agent.debounceMs', 'not-a-number');
        await ctx.fns.procs.http.dispatch({ method: 'POST', url: '/settings/declared', body: fd });

        expect(await ctx.fns.settings.get({ module: 'agent', scopeType: 'global', key: 'debounceMs' }))
            .toBe(1000);
    });
});
