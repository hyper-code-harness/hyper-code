import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

describe('settings declared registry + resolution', () => {
    test('declared list contains seeded entries', async () => {
        const ctx = await mkTestCtx();
        const items = await ctx.fns.settings.declared({});
        const keys = items.map((i: any) => `${i.module}.${i.key}`).sort();
        expect(keys).toContain('llm.defaultModel');
        expect(keys).toContain('llm.lmstudioBaseUrl');
        expect(keys).toContain('agent.debounceMs');
    });

    test('source = default when nothing in DB or env', async () => {
        const ctx = await mkTestCtx();
        const item = (await ctx.fns.settings.declared({})).find((i: any) => i.key === 'defaultModel');
        expect(item.source).toBe('default');
        expect(item.currentValue).toBe('claude-code:claude-opus-5');
    });

    test('source = env when env var set, no DB row', async () => {
        const ctx = await mkTestCtx();
        ctx.env.LMSTUDIO_URL = 'http://env-host:1234';
        const item = (await ctx.fns.settings.declared({})).find((i: any) => i.key === 'lmstudioBaseUrl');
        expect(item.source).toBe('env');
        expect(item.currentValue).toBe('http://env-host:1234');
    });

    test('source = db when set() was called', async () => {
        const ctx = await mkTestCtx();
        ctx.env.LMSTUDIO_URL = 'http://env-host:1234';
        await ctx.fns.settings.set({
            module: 'llm', scopeType: 'global', key: 'lmstudioBaseUrl', value: 'http://db-host:5555',
        });
        const item = (await ctx.fns.settings.declared({})).find((i: any) => i.key === 'lmstudioBaseUrl');
        expect(item.source).toBe('db');
        expect(item.currentValue).toBe('http://db-host:5555');
    });

    test('settings.get fallback chain: DB → env → declared default', async () => {
        const ctx = await mkTestCtx();

        // 1. nothing → declared default
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('claude-code:claude-opus-5');

        // 2. with env → env value
        ctx.env.MODEL = 'env-model';
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('env-model');

        // 3. with DB row → DB value (env still set)
        await ctx.fns.settings.set({ module: 'llm', scopeType: 'global', key: 'defaultModel', value: 'db-model' });
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('db-model');

        // 4. remove DB row → falls back to env again
        await ctx.fns.settings.remove({ module: 'llm', scopeType: 'global', key: 'defaultModel' });
        expect(await ctx.fns.settings.get({ module: 'llm', scopeType: 'global', key: 'defaultModel' }))
            .toBe('env-model');
    });

    test('env parsing respects descriptor.type for number/boolean', async () => {
        const ctx = await mkTestCtx();
        // agent.debounceMs has type 'number' — but no env binding declared.
        // Inject one for the test:
        (ctx.state as any).settings.registry.set('agent.debounceMs', {
            type: 'number', env: 'TEST_DEBOUNCE', default: 5000,
        });
        ctx.env.TEST_DEBOUNCE = '750';
        const v = await ctx.fns.settings.get({ module: 'agent', scopeType: 'global', key: 'debounceMs' });
        expect(v).toBe(750);
        expect(typeof v).toBe('number');
    });

    test('declared default not consulted for non-global scopes', async () => {
        const ctx = await mkTestCtx();
        // No declared (provider, anthropic, baseUrl) — should be undefined.
        const v = await ctx.fns.settings.get({
            module: 'provider', scopeType: 'provider', scopeId: 'anthropic', key: 'baseUrl',
        });
        expect(v).toBeUndefined();
    });

    test('getNumber uses declared default when present, no fallback needed', async () => {
        const ctx = await mkTestCtx();
        const ms = await ctx.fns.settings.getNumber({ module: 'agent', scopeType: 'global', key: 'debounceMs' });
        expect(ms).toBe(1000);
    });

    test('getString fallback param still works for un-declared keys', async () => {
        const ctx = await mkTestCtx();
        const v = await ctx.fns.settings.getString({
            module: 'foo', scopeType: 'global', key: 'undeclared',
            fallback: 'caller-fallback',
        });
        expect(v).toBe('caller-fallback');
    });
});
