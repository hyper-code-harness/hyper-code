import { test, expect } from 'bun:test';
import build from './build';

test('explicit registry blocks static build before lint or manifest writes', async () => {
    let touched = false;
    const ctx: any = { fns: { procs: {
        modules: { readPluginRegistry: async () => ({ version: 1, entries: [] }) },
        dev: { lint: async () => { touched = true; return { ok: true }; }, manifest: async () => { touched = true; } },
    } } };
    await expect(build(ctx, null, {})).rejects.toThrow('does not support pluginRegistry');
    expect(touched).toBe(false);
});

test('legacy build continues to its existing lint gate', async () => {
    const ctx: any = { fns: { procs: {
        modules: { readPluginRegistry: async () => null },
        dev: { lint: async () => ({ ok: false, errors: ['fixture sentinel'] }) },
    } } };
    await expect(build(ctx, null, {})).rejects.toThrow('fixture sentinel');
});
