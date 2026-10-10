import {describe, expect, test} from 'bun:test';
import flex from './flexLayout';
const ctx = {} as Context;
const run = (root: types.svg.FlexNode | null, width?: number, height?: number) => flex(ctx,null,{root,width,height});
describe('flexLayout',()=>{
    test('row grow and padding/gap',async()=>{
        const r=await run({id:'r',direction:'row',padding:10,gap:10,children:[{id:'a',grow:1,height:20},{id:'b',grow:2,height:20}]},330);
        expect(r.boxes.a).toEqual({x:10,y:10,width:100,height:20});
        expect(r.boxes.b).toEqual({x:120,y:10,width:200,height:20});
        expect(r.bounds).toEqual({x:0,y:0,width:330,height:40});
    });
    test('column center and justification',async()=>{
        const r=await run({id:'r',align:'center',justify:'center',children:[{id:'a',width:20,height:30}]},100,100);
        expect(r.boxes.a).toEqual({x:40,y:35,width:20,height:30});
        const j=await run({id:'r',direction:'row',justify:'space-between',children:[{id:'a',width:10,height:10},{id:'b',width:10,height:10}]},100);
        expect(j.boxes.b!.x).toBe(90);
    });
    test('wrap starts lines and applies line gap',async()=>{
        const r=await run({id:'r',direction:'row',wrap:true,gap:10,children:['a','b','c'].map(id=>({id,width:40,height:20}))},100);
        expect(r.boxes.b!.x).toBe(50);expect(r.boxes.c!.y).toBe(30);expect(r.bounds.height).toBe(50);
    });
    test('nested absolute coordinates and asymmetric padding',async()=>{
        const r=await run({id:'r',padding:10,children:[{id:'g',padding:{top:30,left:20,right:5,bottom:7},children:[{id:'a',width:40,height:20}]}]});
        expect(r.boxes.a).toEqual({x:30,y:40,width:40,height:20});expect(r.boxes.g!.x).toBe(10);expect(r.order).toEqual(['r','g','a']);
    });
    test('min/max and shrink, root override',async()=>{
        const r=await run({id:'r',width:999,direction:'row',children:[{id:'a',width:100,shrink:1,minWidth:70,height:10},{id:'b',width:100,shrink:1,height:10}]},100);
        expect(r.boxes.a!.width).toBe(70);expect(r.boxes.b!.width).toBe(30);
        const m=await run({id:'r',children:[{id:'a',width:100,height:100,maxWidth:30,maxHeight:40}]});expect(m.boxes.a!.width).toBe(30);expect(m.boxes.a!.height).toBe(40);
    });
    test('empty and childless root, prototype-like IDs',async()=>{
        expect(await run(null)).toEqual({boxes:{},order:[],bounds:{x:0,y:0,width:0,height:0}});
        expect((await run({id:'__proto__',children:[]})).boxes['__proto__']).toEqual({x:0,y:0,width:0,height:0});
    });
    test('invalid identifiers, values, enums and unsupported fields',async()=>{
        const invalid: unknown[]=[{}, {id:''},{id:' '},{id:'r',children:[{id:'r'}]}, {id:'r',width:NaN},{id:'r',height:Infinity},{id:'r',gap:-1},{id:'r',width:'10'},{id:'r',grow:1000001},{id:'r',padding:{left:-1}},{id:'r',padding:null},{id:'r',padding:{bad:1}},{id:'r',minWidth:20,maxWidth:10},{id:'r',wrap:'true'},{id:'r',align:'baseline'},{id:'r',justify:'bad'},{id:'r',direction:'row-reverse'},{id:'r',children:{}},{id:'r',margin:2}];
        for(const n of invalid) await expect(run(n as types.svg.FlexNode)).rejects.toThrow();
        await expect(run(null,Infinity)).rejects.toThrow();
        await expect(run({id:'r'},-1)).rejects.toThrow();
    });
    test('depth/count bounds and cycles',async()=>{
        let root:types.svg.FlexNode={id:'0'};for(let i=1;i<=64;i++)root={id:String(i),children:[root]};await expect(run(root)).rejects.toThrow('limit');
        await expect(run({id:'r',children:Array.from({length:1000},(_,i)=>({id:String(i)}))})).rejects.toThrow('limit');
        const cycle:types.svg.FlexNode={id:'cycle'};cycle.children=[cycle];await expect(run(cycle)).rejects.toThrow('unique');
    });
    test('overflow bounds contain descendants',async()=>{
        const r=await run({id:'r',align:'center',children:[{id:'a',width:100,height:30}]},20,10);
        expect(r.boxes.a!.x).toBe(-40);expect(r.bounds).toEqual({x:-40,y:0,width:100,height:30});
    });
    test('saved Kubernetes four-group fixture reproduces exactly',async()=>{
        const fixture=await Bun.file(new URL('../../fixtures/flex-kubernetes.json',import.meta.url)).json();
        expect(await run(fixture.root)).toEqual(fixture.layout);
        expect(fixture.layout.bounds).toEqual({x:0,y:0,width:960,height:704});
        expect(fixture.layout.order).toHaveLength(15);
    });
    test('deterministic, no input mutation, repeated success and validation failure',async()=>{
        const n:types.svg.FlexNode={id:'r',width:101,direction:'row',children:[{id:'a',grow:1},{id:'b',grow:2}]};
        const saved=JSON.stringify(n),first=await run(n);
        for(let i=0;i<200;i++){expect(await run(n)).toEqual(first);await expect(run({id:'bad',gap:NaN})).rejects.toThrow();}
        expect(JSON.stringify(n)).toBe(saved);expect(first.boxes.a!.width).toBeCloseTo(101/3,4);
    });
});
