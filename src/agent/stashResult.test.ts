import { expect, test } from 'bun:test';
import stashResult from './stashResult';
import prepare from '../resultStore/prepare';
import truncate from '../tools/truncate';

function harness(fail = false) {
    const writes: any[] = [];
    const ref: types.agent.ResultRef = { version: 1, id: '01900000-0000-7000-8000-000000000001', ownerAgentId: 'test', bytes: 7000, sha256: 'a'.repeat(64), kind: 'read' };
    const agent: any = { id: 'test', scratchpad: { note: 'unchanged' } };
    const ctx: any = { fns: {
        resultStore: { write: async (args: any) => {
            writes.push(args);
            if (fail) throw new Error('disk unavailable');
            return ref;
        } },
        tools: { truncate: (o: any) => truncate(ctx, null, o) },
    } };
    ctx.fns.resultStore.prepare = (o: any) => prepare(ctx, null, o);
    return { writes, ref, agent, run: (output: string, limits?: any) => stashResult(ctx, null, { agent, output, kind: 'read', limits }) };
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

test('output within the limits stays inline and is never written', async () => {
    const h = harness();
    for (const text of ['', 'short', lines(2000)]) expect(await h.run(text)).toEqual({ content: text });
    expect(h.writes).toHaveLength(0);
});

test('head is the default: whole lines from the top, a note naming them, the full text stored', async () => {
    const h = harness();
    const text = lines(5000);
    const r = await h.run(text);
    expect(h.writes).toEqual([{ ownerAgentId: 'test', kind: 'read', text }]);
    expect(r.result_ref).toEqual(h.ref);
    expect(r.content.startsWith('line 1\nline 2\n')).toBe(true);
    expect(r.content).toContain('showing lines 1–2000 of 5000');
    expect(r.content).toContain(h.ref.id);
    expect(r.content).toContain('r.ok ? r.text : r.error');
    expect(r.content).not.toContain('line 2001');
    expect(h.agent.scratchpad).toEqual({ note: 'unchanged' });
});

test('retain: tail keeps the end — the verdict of a command', async () => {
    const h = harness();
    const r = await h.run(lines(5000), { retain: 'tail', maxLines: 100 });
    expect(r.content.endsWith('line 4999\nline 5000')).toBe(true);
    expect(r.content).toContain('showing lines 4901–5000 of 5000');
    expect(r.content).not.toContain('line 4900\n');
});

test('declared limits are honoured, and a byte budget never cuts a line in half', async () => {
    const h = harness();
    const r = await h.run(lines(50), { maxLines: 10 });
    expect(r.content).toContain('showing lines 1–10 of 50');
    const bytes = await h.run(lines(50), { maxBytes: 30 });
    expect(bytes.content.split('\n[')[0]).toBe('line 1\nline 2\nline 3\nline 4');
});

test('storage failure is explicit, bounded and never claims a readable reference', async () => {
    const h = harness(true);
    for (const retain of ['head', 'tail']) {
        const r = await h.run(lines(5000), { retain, maxLines: 100 });
        expect(r.result_ref).toBeUndefined();
        expect(r.content).toContain('storage failed: disk unavailable');
        expect(r.content).toContain('NOT saved');
        expect(r.content).not.toContain('readResult(');
    }
});
