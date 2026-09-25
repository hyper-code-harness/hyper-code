import { expect, test } from 'bun:test';
import unload from './unload';

test('unloads only absent function sources, preserving sibling helpers', async () => {
    const helper = () => 'compact';
    const ctx: any = { state: { registry: { agent: { removed: () => {}, helper } } }, fns: { procs: { project: { scan: async () => [{ kind: 'fn', moduleDir: 'agent', runtimeName: 'helper' }] } } } };
    expect(await unload(ctx, null, { name: 'agent.removed' })).toEqual({ removed: true, name: 'agent.removed' });
    expect(ctx.state.registry.agent.removed).toBeUndefined();
    expect(ctx.state.registry.agent.helper).toBe(helper);
    await expect(unload(ctx, null, { name: 'agent.helper' })).rejects.toThrow('source still exists');
    expect(await unload(ctx, null, { name: 'agent.removed' })).toEqual({ removed: false, name: 'agent.removed' });
    await expect(unload(ctx, null, { name: '__proto__.pollute' })).rejects.toThrow('Invalid');
});
