import {describe, expect, test} from 'bun:test';
import snap from './snapLayoutToGrid';
type Layout = types.svg.GraphLayoutResult;
const ctx = {} as Context;
const make = (boxes: Layout['boxes']): Layout => ({boxes,routes:boxes.slice(1).map((b,i)=>({id:`e${i}`,from:boxes[i]!.id,to:b.id,points:[]})),bounds:{x:0,y:0,width:0,height:0},metadata:{algorithm:'test',engine:'test',routing:'orthogonal',warnings:[]}});
const boxes = (n:number) => Array.from({length:n},(_,i)=>({id:`b${i}`,x:(i*37)%113,y:(i*53)%137,w:20,h:10}));
function invariant(a:Layout,b:Layout) {
    expect(b.boxes.map(({id,w,h})=>({id,w,h}))).toEqual(a.boxes.map(({id,w,h})=>({id,w,h})));
    const seen=new Set<string>();
    for(const q of b.boxes){const key=`${q.x+q.w/2},${q.y+q.h/2}`;expect(seen.has(key)).toBe(false);seen.add(key);expect(q.x>=b.bounds.x&&q.y>=b.bounds.y&&q.x+q.w<=b.bounds.x+b.bounds.width&&q.y+q.h<=b.bounds.y+b.bounds.height).toBe(true);}
    for(let i=0;i<b.boxes.length;i++)for(let j=i+1;j<b.boxes.length;j++){const p=b.boxes[i]!,q=b.boxes[j]!;expect(p.x+p.w<=q.x||q.x+q.w<=p.x||p.y+p.h<=q.y||q.y+q.h<=p.y).toBe(true);}
    expect(b.routes.map(({id,from,to})=>({id,from,to}))).toEqual(a.routes.map(({id,from,to})=>({id,from,to})));
    for(const e of b.routes)for(const [i,id] of [e.from,e.to].entries()){const q=b.boxes.find(q=>q.id===id)!,p=e.points[i]!;expect(p.x>=q.x-1e-7&&p.x<=q.x+q.w+1e-7&&p.y>=q.y-1e-7&&p.y<=q.y+q.h+1e-7).toBe(true);expect(Math.min(Math.abs(p.x-q.x),Math.abs(p.x-q.x-q.w),Math.abs(p.y-q.y),Math.abs(p.y-q.y-q.h))).toBeLessThan(1e-7);}
}
describe('snapLayoutToGrid',()=>{
    test('empty and singleton',async()=>{expect((await snap(ctx,null,{layout:make([])})).bounds).toEqual({x:0,y:0,width:0,height:0});const a=make(boxes(1)),b=await snap(ctx,null,{layout:a});invariant(a,b);expect(b.bounds).toEqual({x:0,y:0,width:20,height:10});});
    test('Hungarian cost equals exhaustive rectangular assignment including ties',async()=>{
        for(let seed=0;seed<18;seed++) {
            const n=2+seed%3,c=2,r=Math.ceil(Math.ceil(n/0.75)/c),g=Array.from({length:c*r},(_,j)=>({x:10+(j%c)*25,y:5+Math.floor(j/c)*17}));
            const a=make(boxes(n).map((b,i)=>({...b,x:((seed+3)*(i+1)*19)%43,y:seed%3===0?0:((seed+7)*(i+2)*13)%47})));
            const b=await snap(ctx,null,{layout:a,gapX:5,gapY:7,occupancy:0.75,columns:c});invariant(a,b);
            const centers=a.boxes.map(q=>({x:q.x+10,y:q.y+5}));const loX=Math.min(...centers.map(q=>q.x)),hiX=Math.max(...centers.map(q=>q.x)),loY=Math.min(...centers.map(q=>q.y)),hiY=Math.max(...centers.map(q=>q.y));
            const target=centers.map(q=>({x:10+(hiX===loX?.5:(q.x-loX)/(hiX-loX))*25,y:5+(hiY===loY?.5:(q.y-loY)/(hiY-loY))*(r-1)*17}));
            const cost=(i:number,q:{x:number;y:number})=>(target[i]!.x-q.x)**2+(target[i]!.y-q.y)**2;
            let best=Infinity;function brute(i:number,used:Set<number>,sum:number){if(i===n){best=Math.min(best,sum);return;}for(let j=0;j<g.length;j++)if(!used.has(j)){used.add(j);brute(i+1,used,sum+cost(i,g[j]!));used.delete(j);}}brute(0,new Set(),0);
            expect(b.boxes.reduce((sum,q,i)=>sum+cost(i,{x:q.x+10,y:q.y+5}),0)).toBeCloseTo(best,6);
        }
    });
    test('sizes, determinism, no mutation and degenerate axes with sparse occupancy',async()=>{for(const axis of ['x','y','both']){const a=make(boxes(13).map((b,i)=>({...b,x:axis==='y'?b.x:0,y:axis==='x'?b.y:0,w:20+i%4,h:10+i%5}))),saved=JSON.stringify(a);const b=await snap(ctx,null,{layout:a,occupancy:0.3});invariant(a,b);expect(await snap(ctx,null,{layout:a,occupancy:0.3})).toEqual(b);expect(JSON.stringify(a)).toBe(saved);}});
    test('validates options and geometry',async()=>{for(const o of [{gapX:-1},{gapY:NaN},{gapX:Infinity},{gapY:1000001},{occupancy:0},{occupancy:0.09},{occupancy:1.1},{columns:0},{columns:1.5},{columns:601},{columns:4}])await expect(snap(ctx,null,{layout:make(boxes(3)),...o})).rejects.toThrow();for(const a of [make(boxes(61)),make([{...boxes(1)[0]!,w:0}]),make([{...boxes(1)[0]!,x:Infinity}]),make([boxes(1)[0]!,boxes(1)[0]!])])await expect(snap(ctx,null,{layout:a})).rejects.toThrow();const a=make(boxes(2));a.routes[0]!.to='missing';await expect(snap(ctx,null,{layout:a})).rejects.toThrow();a.routes[0]!.to=a.routes[0]!.from;await expect(snap(ctx,null,{layout:a})).rejects.toThrow();});
    test('bounded maximum input',async()=>{const a=make(boxes(60)),b=await snap(ctx,null,{layout:a,occupancy:0.1,columns:599});invariant(a,b);});
    test('original Kubernetes ACA becomes 3 columns by 4 rows, not a pixel square',async()=>{const fixture=await Bun.file(new URL('../../fixtures/compact-kubernetes.json',import.meta.url)).json();const b=await snap(ctx,null,{layout:fixture.before});invariant(fixture.before,b);expect(b.bounds).toEqual({x:0,y:0,width:760,height:406});expect(new Set(b.boxes.map(q=>q.x)).size).toBe(3);expect(new Set(b.boxes.map(q=>q.y)).size).toBe(4);expect(b.metadata.routing).toBe('straight');expect(b.metadata.warnings.join(' ')).toContain('not obstacle-avoiding');});
});
