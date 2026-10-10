import { describe, test, expect } from 'bun:test';
import force from './layoutForce';
import hola from './layoutHola';
import compact from './layoutCompact';
import incremental from './layoutIncremental';
import validate from './layoutValidate';
import result from './layoutResult';
import graph from '../../fixtures/layout-tables.json';

const ctx = { fns: { svg: {
    layoutValidate: (o: Parameters<typeof validate>[2]) => validate(ctx as Context, null, o),
    layoutResult: (o: Parameters<typeof result>[2]) => result(ctx as Context, null, o),
} } };
const engines = { force, hola, compact, incremental };
for (const [name, fn] of Object.entries(engines)) describe(name, () => {
    test('empty graph needs no engine', async () => {
        const r = await fn(ctx as Context, null, { nodes: [], edges: [] });
        expect(r.boxes).toEqual([]); expect(r.routes).toEqual([]);
        expect(r.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    });
    test('reject invalid IDs and sizes', async () => {
        await expect(fn(ctx as Context, null, { nodes: graph.nodes, edges: [{id:'bad',from:'missing',to:'users'}] })).rejects.toThrow('endpoint');
        await expect(fn(ctx as Context, null, { nodes: [graph.nodes[0]!, graph.nodes[0]!], edges: [] })).rejects.toThrow('unique');
        await expect(fn(ctx as Context, null, { nodes: [{id:'a',w:NaN,h:1}], edges: [] })).rejects.toThrow('finite');
        await expect(fn(ctx as Context, null, { nodes: graph.nodes, edges: [graph.edges[0]!, graph.edges[0]!] })).rejects.toThrow('unique');
        await expect(fn(ctx as Context, null, { nodes: graph.nodes, edges: [{id:'loop',from:'users',to:'users'}] })).rejects.toThrow('Self-loops');
    });
    test('12-table benchmark: finite geometry, identity and native routes', async () => {
        const r = await fn(ctx as Context, null, graph);
        expect(r.boxes.map(b=>b.id)).toEqual(graph.nodes.map(n=>n.id));
        expect(r.routes.map(e=>e.id)).toEqual(graph.edges.map(e=>e.id));
        for (const b of r.boxes) expect([b.x,b.y,b.w,b.h].every(Number.isFinite)).toBe(true);
        for (const e of r.routes) {
            expect(e.points.length).toBeGreaterThanOrEqual(2);
            for (const p of e.points) expect(Number.isFinite(p.x)&&Number.isFinite(p.y)).toBe(true);
            if (r.metadata.routing==='straight') expect(e.points.length).toBe(2);
            else for(let i=1;i<e.points.length;i++) expect(Math.min(Math.abs(e.points[i]!.x-e.points[i-1]!.x),Math.abs(e.points[i]!.y-e.points[i-1]!.y))).toBeLessThan(0.001);
        }
        expect(r.bounds.width).toBeGreaterThan(0); expect(r.bounds.height).toBeGreaterThan(0);
    }, 60000);
});
test('force repeatability with fixed seed/ticks and no input mutation', async () => {
    const before=JSON.stringify(graph);
    const a=await force(ctx as Context,null,{...graph,seed:42,iterations:100});
    const b=await force(ctx as Context,null,{...graph,seed:42,iterations:100});
    expect(a).toEqual(b); expect(JSON.stringify(graph)).toBe(before);
},60000);
test('force rejects invalid tuning options',async()=>{
    await expect(force(ctx as Context,null,{...graph,seed:-1})).rejects.toThrow('seed');
    await expect(force(ctx as Context,null,{...graph,iterations:0})).rejects.toThrow('iterations');
});
test('finalizer rejects nonfinite routes',async()=>{
    await expect(result(ctx as Context,null,{boxes:[],routes:[{id:'e',from:'a',to:'b',points:[{x:0,y:0},{x:Infinity,y:0}]}],metadata:{algorithm:'test',engine:'test',routing:'straight',warnings:[]}})).rejects.toThrow('nonfinite');
});
for(const [name,fn] of Object.entries({hola,compact,incremental})) test(name+' enforces timeout',async()=>{
    await expect(fn(ctx as Context,null,{...graph,timeoutMs:1})).rejects.toThrow('timed out');
},10000);
for(const [name,fn] of Object.entries(engines)) test(name+' supports disconnected nodes',async()=>{
    const r=await fn(ctx as Context,null,{nodes:[{id:'a',w:50,h:20},{id:'b',w:30,h:40}],edges:[]});
    expect(r.boxes.length).toBe(2);expect(r.routes).toEqual([]);
},60000);
