import { expect, test } from 'bun:test';
import stashResult from './stashResult';
import prepare from '../resultStore/prepare';

function harness(fail = false) {
    const writes: any[] = [];
    const ref: types.agent.ResultRef = { version: 1, id: '01900000-0000-7000-8000-000000000001', ownerAgentId: 'test', bytes: 7000, sha256: 'a'.repeat(64), kind: 'read' };
    const agent: any = { id: 'test', scratchpad: { note: 'unchanged' } };
    const ctx: any = { fns: { resultStore: { write: async (args: any) => {
        writes.push(args);
        if (fail) throw new Error('disk unavailable');
        return ref;
    } } } };
    ctx.fns.resultStore.prepare = (o: any) => prepare(ctx, null, o);
    return { writes, ref, agent, run: (output: string, kind = 'read') => stashResult(ctx, null, { agent, output, kind }) };
}

test('inline threshold includes exactly 6000 characters and never writes', async () => {
    const h = harness();
    for (const text of ['', 'short', 'x'.repeat(6000)]) expect(await h.run(text)).toEqual({ content: text });
    expect(h.writes).toHaveLength(0);
});

test('large single-line output is stored completely with a bounded useful head and UUID', async () => {
    const h = harness();
    const text = 'HEAD' + 'x'.repeat(7000) + 'TAIL';
    const r = await h.run(text);
    expect(h.writes).toEqual([{ ownerAgentId: 'test', kind: 'read', text }]);
    expect(r.result_ref).toEqual(h.ref);
    expect(r.content.startsWith(text.slice(0, 2500))).toBe(true);
    expect(r.content.length).toBeLessThan(3200);
    expect(r.content).toContain('await ctx.fns.agent.readResult({ id:');
    expect(r.content).toContain(h.ref.id);
    expect(r.content).not.toContain('scratchpad');
    expect(h.agent.scratchpad).toEqual({ note: 'unchanged' });
});

test('bash retains bounded tail, including for output without newlines', async () => {
    const h = harness();
    const text = 'HEAD' + 'x'.repeat(7000) + 'TAIL';
    const r = await h.run(text, 'bash');
    expect(r.content.endsWith(text.slice(-2500))).toBe(true);
    expect(r.content).toContain('tail preview');
});

test('storage failure is explicit, bounded and never claims a readable reference', async () => {
    const h = harness(true);
    for (const kind of ['read', 'bash']) {
        const r = await h.run('x'.repeat(7000), kind);
        expect(r.result_ref).toBeUndefined();
        expect(r.content).toContain('storage failed: disk unavailable');
        expect(r.content).toContain('NOT saved');
        expect(r.content).not.toContain('readResult(');
        expect(r.content.length).toBeLessThan(3200);
    }
});
