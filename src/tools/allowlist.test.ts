import { describe, test, expect } from 'bun:test';
import { mkTestCtx } from '../_testCtx.entry';

// Agent tool list and opt-in tools: schemas hide opt-in tools unless named;
// tools.call logs a call outside the list and refuses it only when
// tools.enforceAllowlist is on.
async function setup(enforce?: boolean) {
    const ctx: any = await mkTestCtx();
    ctx.fns.files.read = async () => 'a\nb';
    const registry: Map<string, any> = ctx.state.tools.registry;
    const read = registry.get('tools.read') ?? [...registry.values()].find((t: any) => t.name === 'read');
    registry.set('test.secretTool', { ...read, key: 'test.secretTool', name: 'secretTool', module: 'test', optIn: true });
    const warns: any[] = [];
    ctx.fns.procs.log.warn = (_c: any, _s: any, o: any) => { warns.push(o); };
    const realGet = ctx.fns.settings.get;
    ctx.fns.settings.get = async (c: any, s: any, o: any) =>
        o.module === 'tools' && o.key === 'enforceAllowlist' && enforce !== undefined ? enforce : realGet(c, s, o);
    return { ctx, warns, cleanup: () => registry.delete('test.secretTool') };
}

describe('opt-in tools', () => {
    test('an opt-in tool is left out unless the agent names it', async () => {
        const { ctx, cleanup } = await setup();
        try {
            const names = (only?: string[]) => ctx.fns.tools.schemas({ api: 'anthropic', only }).map((t: any) => t.name);
            expect(names()).not.toContain('secretTool');
            expect(names()).toContain('read');
            expect(names(['read'])).toEqual(['read']);
            expect(names(['read', 'secretTool']).sort()).toEqual(['read', 'secretTool']);
        } finally { cleanup(); }
    });
});

describe('tools.call allowlist', () => {
    test('default (log only): a call outside the list runs and warns', async () => {
        const { ctx, warns, cleanup } = await setup();
        try {
            const agent: any = { id: 'zz', tools: ['bash'] };
            const r = await ctx.fns.tools.call({ name: 'read', args: { path: 'x' }, agent });
            expect(r).toEqual({ output: 'a\nb', isError: false });
            expect(warns.map(w => w.event)).toContain('tools.call.not-allowed');
        } finally { cleanup(); }
    });

    test('no tool list and no opt-in → no warning at all', async () => {
        const { ctx, warns, cleanup } = await setup();
        try {
            const r = await ctx.fns.tools.call({ name: 'read', args: { path: 'x' }, agent: { id: 'zz' } as any });
            expect(r.isError).toBe(false);
            const listed = await ctx.fns.tools.call({ name: 'read', args: { path: 'x' }, agent: { id: 'zz', tools: ['read'] } as any });
            expect(listed.isError).toBe(false);
            expect(warns.filter(w => w.event === 'tools.call.not-allowed')).toEqual([]);
        } finally { cleanup(); }
    });

    test('enforced: outside the list and unnamed opt-in are refused', async () => {
        const { ctx, cleanup } = await setup(true);
        try {
            const outside = await ctx.fns.tools.call({ name: 'read', args: { path: 'x' }, agent: { id: 'zz', tools: ['bash'] } as any });
            expect(outside.isError).toBe(true);
            expect(outside.output).toContain('not in the agent\'s tool list');
            const optIn = await ctx.fns.tools.call({ name: 'secretTool', args: { path: 'x' }, agent: { id: 'zz' } as any });
            expect(optIn.isError).toBe(true);
            expect(optIn.output).toContain('opt-in');
            const named = await ctx.fns.tools.call({ name: 'secretTool', args: { path: 'x' }, agent: { id: 'zz', tools: ['secretTool'] } as any });
            expect(named.isError).toBe(false);
        } finally { cleanup(); }
    });
});
