import { describe, expect, test } from 'bun:test';
import compact from './compactLayout';
const ctx = {} as Context;
type Layout = types.svg.GraphLayoutResult;
function layout(boxes: Layout['boxes']): Layout {
    return {boxes,routes:boxes.slice(1).map((b,i)=>({id:`e${i}`,from:boxes[i]!.id,to:b.id,points:[{x:9999,y:9999}]})),bounds:{x:99,y:99,width:1,height:1},metadata:{algorithm:'fixture',engine:'test',routing:'orthogonal',warnings:[]}};
}
function check(r: Layout, grid=50, gap=32) {
    for (const b of r.boxes) {
        expect(b.x%grid).toBe(0); expect(b.y%grid).toBe(0);
        expect(b.x+b.w).toBeLessThanOrEqual(r.bounds.width);
        expect(b.y+b.h).toBeLessThanOrEqual(r.bounds.height);
    }
    for(let i=0;i<r.boxes.length;i++)for(let j=i+1;j<r.boxes.length;j++) {
        const a=r.boxes[i]!,b=r.boxes[j]!;
        expect(a.x+a.w+gap<=b.x || b.x+b.w+gap<=a.x || a.y+a.h+gap<=b.y || b.y+b.h+gap<=a.y).toBe(true);
    }
    expect(Object.values(r.bounds).every(Number.isFinite)).toBe(true);
    for(const e of r.routes) {
        expect(e.points.length).toBe(2);
        for(const [i,id] of [e.from,e.to].entries()) {
            const b=r.boxes.find(b=>b.id===id)!,p=e.points[i]!;
            expect(Number.isFinite(p.x)&&Number.isFinite(p.y)).toBe(true);
            expect(p.x>=b.x-1e-7&&p.x<=b.x+b.w+1e-7&&p.y>=b.y-1e-7&&p.y<=b.y+b.h+1e-7).toBe(true);
            expect(Math.min(Math.abs(p.x-b.x),Math.abs(p.x-b.x-b.w),Math.abs(p.y-b.y),Math.abs(p.y-b.y-b.h))).toBeLessThan(1e-7);
        }
    }
}
describe('compactLayout',()=>{
    test('saved Kubernetes example reproduces with all nine relationships',async()=>{
        const fixture=await Bun.file(new URL('../../fixtures/independent-kubernetes.json',import.meta.url)).json();
        const r=await compact(ctx,null,{layout:fixture.before,gridSize:50,gap:32,focusId:'Pod'});
        expect(r).toEqual(fixture.after);check(r);
        expect(r.boxes.length).toBe(10);expect(r.routes.length).toBe(9);
        expect(r.bounds).toEqual({x:0,y:0,width:1420,height:464});
        // Do not reward artificial height just to make the bounds look square.
        expect(r.bounds.height).toBeLessThan(fixture.previous.bounds.height);
        expect(r.bounds.width*r.bounds.height).toBeLessThan(fixture.before.bounds.width*fixture.before.bounds.height);
        for(let i=0;i<r.boxes.length;i++)for(let j=i+1;j<r.boxes.length;j++)for(const k of ['x','y'] as const) {
            expect((r.boxes[j]![k]-r.boxes[i]![k])*(fixture.before.boxes[j][k]-fixture.before.boxes[i][k])).toBeGreaterThanOrEqual(0);
        }
        const byId=new Map(r.boxes.map(b=>[b.id,b])),pod=byId.get('Pod')!;
        for(const id of ['Deployment','ReplicaSet','Container','ConfigMap / Secret']) expect(byId.get(id)!.x).toBeLessThan(pod.x);
        for(const id of ['Service','Ingress','PV']) expect(byId.get(id)!.x).toBeGreaterThan(pod.x);
        expect(byId.get('Node')!.x).toBe(pod.x);expect(byId.get('PVC')!.x).toBe(pod.x);
        expect(byId.get('Node')!.y).toBeLessThan(pod.y);expect(byId.get('PVC')!.y).toBeGreaterThan(pod.y);
        expect(new Set(r.boxes.map(b=>b.x)).size).toBeGreaterThan(2);
        await expect(compact(ctx,null,{layout:fixture.before,focusId:'missing'})).rejects.toThrow('focusId');
    });
    test('blocked upper chain does not stop independent lower branches',async()=>{
        const fixture=await Bun.file(new URL('../../fixtures/independent-kubernetes.json',import.meta.url)).json();
        const r=await compact(ctx,null,{layout:fixture.before,gridSize:50,gap:32,focusId:'Pod'});
        const byId=new Map(r.boxes.map(b=>[b.id,b]));
        for(const id of ['Deployment','ReplicaSet','Node','Ingress','Service','Pod']) {
            expect(byId.get(id)).toEqual(fixture.previous.boxes.find((b:Layout['boxes'][number])=>b.id===id));
        }
        for(const [id,y] of [['Container',200],['ConfigMap / Secret',300],['PVC',400],['PV',400]] as const) {
            expect(byId.get(id)!.y).toBe(y);
            expect(byId.get(id)!.y).toBeLessThan(fixture.previous.boxes.find((b:Layout['boxes'][number])=>b.id===id).y);
        }
        expect(r.routes.map(({id,from,to})=>({id,from,to}))).toEqual(fixture.before.routes.map(({id,from,to}:Layout['routes'][number])=>({id,from,to})));
        check(r);
    });
    test('empty and singleton',async()=>{
        const empty=await compact(ctx,null,{layout:layout([])});
        expect(empty.boxes).toEqual([]);expect(empty.routes).toEqual([]);expect(empty.bounds).toEqual({x:0,y:0,width:0,height:0});
        const one=await compact(ctx,null,{layout:layout([{id:'a',x:-543,y:321,w:220,h:64}])});
        expect(one.boxes).toEqual([{id:'a',x:0,y:0,w:220,h:64}]);check(one);
    });
    test('mixed sizes, IDs, borders, no mutation and deterministic output',async()=>{
        const input=layout(Array.from({length:35},(_,i)=>({id:`b${i}`,x:(i%6)*340-400,y:Math.floor(i/6)*140-200,w:31+(i*37)%270,h:25+(i*29)%123})));
        const before=JSON.stringify(input),r=await compact(ctx,null,{layout:input});check(r);
        expect(JSON.stringify(input)).toBe(before);expect(await compact(ctx,null,{layout:input})).toEqual(r);
        expect(r.boxes.map(({id,w,h})=>({id,w,h}))).toEqual(input.boxes.map(({id,w,h})=>({id,w,h})));
        expect(r.routes.map(({id,from,to})=>({id,from,to}))).toEqual(input.routes.map(({id,from,to})=>({id,from,to})));
        expect(r.metadata.routing).toBe('straight');expect(r.routes).not.toEqual(input.routes);
    });
    test('custom grid, gap zero, maximal size and coordinate bounds',async()=>{
        const input=layout(Array.from({length:60},(_,i)=>({id:`b${i}`,x:i%2?1e9:-1e9,y:0,w:i%3?0.25:1e6,h:1e6})));
        check(await compact(ctx,null,{layout:input,gridSize:7,gap:0}),7,0);
    });
    test('invalid options and geometry fail explicitly',async()=>{
        const good=layout([{id:'a',x:0,y:0,w:220,h:64},{id:'b',x:0,y:0,w:220,h:64}]);
        for(const gridSize of [0,-1,1.5,NaN,Infinity,1000001]) await expect(compact(ctx,null,{layout:good,gridSize})).rejects.toThrow('gridSize');
        for(const gap of [-1,NaN,Infinity,1000001]) await expect(compact(ctx,null,{layout:good,gap})).rejects.toThrow('gap');
        for(const patch of [{w:0},{w:NaN},{h:-1},{x:Infinity},{x:1e10},{h:1000001}]) await expect(compact(ctx,null,{layout:layout([{...good.boxes[0]!,...patch}])})).rejects.toThrow('finite');
        await expect(compact(ctx,null,{layout:layout([good.boxes[0]!,good.boxes[0]!])})).rejects.toThrow('unique');
        await expect(compact(ctx,null,{layout:{...good,routes:[{...good.routes[0]!,to:'missing'}]}})).rejects.toThrow('endpoint');
        await expect(compact(ctx,null,{layout:{...good,routes:[{...good.routes[0]!,to:'a'}]}})).rejects.toThrow('Self-loops');
        await expect(compact(ctx,null,{layout:{...good,routes:[good.routes[0]!,good.routes[0]!]}})).rejects.toThrow('unique');
        await expect(compact(ctx,null,{layout:layout(Array.from({length:61},(_,i)=>({...good.boxes[0]!,id:String(i)})))})).rejects.toThrow('60');
        await expect(compact(ctx,null,{layout:{...good,routes:Array(301).fill(good.routes[0])}})).rejects.toThrow('300');
    });
});
