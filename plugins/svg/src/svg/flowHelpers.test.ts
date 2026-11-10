import { describe, expect, test } from 'bun:test';
import flowHelpers from './flowHelpers';
import flowDiagram from './flowDiagram';
import measureText from './measureText';
const ctx = { fns: { svg: { measureText: (opts: Parameters<typeof measureText>[2]) => measureText({} as Context, null, opts) } } } as Context;
const helpers = () => flowHelpers(ctx, null, {});

describe('synchronous typed flow helpers', () => {
    test('maps shapes and typed references to plain JSON synchronously', async () => {
        const { step, decision, database, link } = await helpers();
        const a = step('Check'), b = decision('Paid?'), c = database('Orders');
        expect([a, b, c]).toEqual([
            { id: 'node-1', label: 'Check', shape: 'rect' },
            { id: 'node-2', label: 'Paid?', shape: 'diamond' },
            { id: 'node-3', label: 'Orders', shape: 'cylinder' },
        ]);
        const edges: types.svg.FlowEdge[] = [link(a, b), link(b, c, 'Yes'), link(a, c, '')];
        expect(edges).toEqual([{ from: a.id, to: b.id }, { from: b.id, to: c.id, label: 'Yes' }, { from: a.id, to: c.id, label: '' }]);
        expect(Object.hasOwn(edges[0]!, 'label')).toBe(false);
        expect(JSON.parse(JSON.stringify({ nodes: [a, b, c], edges }))).toEqual({ nodes: [a, b, c], edges });
        a.id = 'changed';
        expect(edges[0]!.from).toBe('node-1');
    });
    test('all node kinds share deterministic IDs and factories are isolated', async () => {
        const build = (h: types.svg.FlowConstructors) => [h.step('a'), h.decision('b'), h.database('c')];
        const first = await helpers(), second = await helpers();
        expect(build(first)).toEqual(build(second));
        first.step('extra');
        expect(second.step('d').id).toBe('node-4');
        expect((await helpers()).step('reset').id).toBe('node-1');
    });
    test('explicit IDs reserve names across shapes; generated IDs skip reservations', async () => {
        const h = await helpers();
        expect(h.database('reserved', { id: 'node-1' }).id).toBe('node-1');
        expect(h.step('generated').id).toBe('node-2');
        expect(() => h.decision('duplicate', { id: 'node-1' })).toThrow('Duplicate');
        expect(() => h.database('duplicate generated', { id: 'node-2' })).toThrow('Duplicate');
        expect(h.decision('stable', { id: 'paid' }).id).toBe('paid');
        expect(h.step('next').id).toBe('node-3');
        expect((await helpers()).step('independent', { id: 'paid' }).id).toBe('paid');
        expect(h.step('prototype', { id: '__proto__' }).id).toBe('__proto__');
    });
    test('rejects invalid explicit IDs without consuming generated IDs', async () => {
        const h = await helpers();
        for (const id of ['', '   ', 'x'.repeat(129)]) expect(() => h.step('a', { id })).toThrow('ID');
        expect(h.step('valid').id).toBe('node-1');
    });
    test('ordinary reusable fragments need no prefixes', async () => {
        const { step, decision, link } = await helpers();
        const fragment = (label: string) => {
            const start = step(label), end = decision('Ready?');
            return { nodes: [start, end], edges: [link(start, end)], start, end };
        };
        const first = fragment('First'), second = fragment('Second');
        const nodes = [...first.nodes, ...second.nodes];
        const edges = [...first.edges, ...second.edges, link(first.end, second.start, 'Yes')];
        expect(new Set(nodes.map(n => n.id)).size).toBe(4);
        const r = await flowDiagram(ctx, null, { nodes, edges });
        expect(r.boxes).toHaveLength(4);
        expect(r.routes).toHaveLength(3);
    });
    test('renders order branches and a storage node; preserves DAG-only validation', async () => {
        const { step, decision, database, link } = await helpers();
        const check = step('Проверить заказ'), paid = decision('Оплачен?');
        const fulfilled = step('Выполнить заказ'), pending = step('Ожидать оплату'), db = database('Заказы');
        const nodes = [check, paid, fulfilled, pending, db];
        const edges = [link(check, paid), link(paid, fulfilled, 'Да'), link(paid, pending, 'Нет'), link(fulfilled, db)];
        for (const direction of ['right', 'down'] as const) {
            const r = await flowDiagram(ctx, null, { nodes, edges, direction, title: 'Заказ' });
            expect(r.engine).toBe('elk-layered');
            expect(r.boxes).toHaveLength(5);
            expect(r.routes).toHaveLength(4);
            expect(r.svg).toContain('Оплачен?');
            expect(r.svg).not.toMatch(/NaN|undefined|Infinity/);
        }
        await expect(flowDiagram(ctx, null, { nodes, edges: [...edges, link(pending, check)] })).rejects.toThrow();
        await expect(flowDiagram(ctx, null, { nodes, edges: [link(check, check)] })).rejects.toThrow();
        await expect(flowDiagram(ctx, null, { nodes, edges: [link(check, paid), link(check, paid)] })).rejects.toThrow();
    });
});

test('link bundle options preserve legacy plain objects',async()=>{
    const {step,link}=await helpers(),a=step('A'),b=step('B');
    expect(link(a,b)).toEqual({from:a.id,to:b.id});
    expect(link(a,b,'Нет')).toEqual({from:a.id,to:b.id,label:'Нет'});
    expect(link(a,b,'No',{bundle:'stop'})).toEqual({from:a.id,to:b.id,label:'No',bundle:'stop'});
    expect(link(a,b,undefined,{bundle:'stop'})).toEqual({from:a.id,to:b.id,bundle:'stop'});
});
