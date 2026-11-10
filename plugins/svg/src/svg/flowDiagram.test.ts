import {describe, test, expect} from 'bun:test';
import flowDiagram from './flowDiagram';
import measureText from './measureText';
const ctx = {fns:{svg:{measureText:(o:Parameters<typeof measureText>[2])=>measureText({} as Context,null,o)}}} as Context;
type Options = Parameters<typeof flowDiagram>[2];
const run=(o:Options)=>flowDiagram(ctx,null,o);
const nodes:Options['nodes']=[{id:'user',label:'Пользователь'},{id:'api',label:'API'},{id:'access',label:'Доступ разрешён?',shape:'diamond'},{id:'db',label:'Postgres',shape:'cylinder'},{id:'deny',label:'403 · Нет доступа'}];
const edges:Options['edges']=[{from:'user',to:'api'},{from:'api',to:'access'},{from:'access',to:'db',label:'Да'},{from:'access',to:'deny',label:'Нет'}];
describe('flowDiagram',()=>{
    for(const direction of ['right','down'] as const) test('branch '+direction+' has orthogonal shape-boundary routes',async()=>{
        const r=await run({nodes,edges,direction,title:'Проверка доступа'});
        expect(r.engine).toBe('elk-layered'); expect(r.boxes).toHaveLength(5);expect(r.routes).toHaveLength(4);
        for(const route of r.routes){
            const a=r.boxes.find(n=>n.id===route.from)!,b=r.boxes.find(n=>n.id===route.to)!;
            expect(route.points[0]).toEqual(direction==='right'?{x:a.x+a.width,y:a.y+a.height/2}:{x:a.x+a.width/2,y:a.y+a.height});
            expect(route.points.at(-1)).toEqual(direction==='right'?{x:b.x,y:b.y+b.height/2}:{x:b.x+b.width/2,y:b.y});
            for(let i=1;i<route.points.length;i++){const p=route.points[i-1]!,q=route.points[i]!;expect(p.x===q.x || p.y===q.y).toBe(true);}
        }
        expect(r.svg).not.toMatch(/NaN|undefined|Infinity/);expect(r.svg).toContain('Да');
        for(const b of r.boxes){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(r.width);expect(b.y+b.height).toBeLessThanOrEqual(r.height);}
    });
    test('chain, empty and disconnected graphs',async()=>{
        const chain=await run({nodes:nodes.slice(0,3),edges:edges.slice(0,2)});expect(chain.boxes[2]!.x).toBeGreaterThan(chain.boxes[1]!.x);
        const empty=await run({nodes:[],edges:[]});expect(empty.boxes).toEqual([]);expect(empty.width).toBe(240);
        const disconnected=await run({nodes,edges:[]});expect(disconnected.boxes).toHaveLength(5);
    });
    test('XML escaping and prototype IDs',async()=>{
        const r=await run({title:'<script> & "title"',nodes:[{id:'__proto__',label:'<a>&"'},{id:'constructor',label:'b'}],edges:[{from:'__proto__',to:'constructor',label:'<x>&'}]});
        expect(r.svg).toContain('&lt;script&gt; &amp; &quot;title&quot;');expect(r.svg).toContain('&lt;a&gt;&amp;&quot;');expect(r.svg).toContain('&lt;x&gt;&amp;');expect(r.svg).not.toContain('<script>');
    });
    test('invalid references, cycles, duplicates and limits',async()=>{
        const bad:Options[]=[{nodes,edges:[{from:'user',to:'missing'}]},{nodes,edges:[{from:'user',to:'user'}]},{nodes,edges:[{from:'user',to:'api'},{from:'api',to:'user'}]},{nodes:[nodes[0]!,nodes[0]!],edges:[]},{nodes,edges:[edges[0]!,edges[0]!]},{nodes:Array.from({length:101},(_,i)=>({id:String(i),label:'x'})),edges:[]},{nodes:[{id:'x',label:'x'.repeat(301)}],edges:[]},{nodes:[{id:'x',label:'\u0000'}],edges:[]},{nodes,edges:[{from:'user',to:'api',label:'a\nb'}]}];
        for(const input of bad) await expect(run(input)).rejects.toThrow();
        await expect(run({nodes,edges,direction:'sideways' as 'right'})).rejects.toThrow();
    });
    test('spacing controls preserve defaults and reject malformed options',async()=>{
        const base=await run({nodes,edges});
        const explicit=await run({nodes,edges,compact:false,nodeGap:40,layerGap:64});
        expect(explicit.boxes).toEqual(base.boxes);expect(explicit.routes).toEqual(base.routes);
        for(const field of ['nodeGap','layerGap'] as const) for(const value of [NaN,Infinity,-1,0,11,201]) await expect(run({nodes,edges,[field]:value})).rejects.toThrow();
        for(const mainPath of [[],['user'],['user','missing'],['user','user'],['api','user'],['user','db']]) await expect(run({nodes,edges,mainPath})).rejects.toThrow();
        await expect(run({nodes,edges,compact:'yes' as unknown as boolean})).rejects.toThrow();
        const chain={nodes:nodes.slice(0,3),edges:edges.slice(0,2)};
        const tight=await run({...chain,layerGap:12,nodeGap:12});const loose=await run({...chain,layerGap:120,nodeGap:120});
        expect(tight.width).toBeLessThan(loose.width);
    });
    for(const direction of ['down','right'] as const) test('compact failover preserves shapes and aligns the preferred path '+direction,async()=>{
        const names=['alert','confirm','transient','quorum','stop','fence','fenced','select','eligible','replay','promote','ready','route','clients','replicas','old','restore'];
        const labels=['Сбой primary','Сбой подтверждён?','Временный сбой','Есть кворум?','СТОП · ручная проверка','Изолировать primary','Primary изолирован?','Выбрать реплику','Реплика пригодна?','Догнать WAL','Promote','Новый primary готов?','Переключить трафик','Проверить клиентов','Подключить реплики','Вернуть старый узел','Восстановить резервирование'];
        const mainPath=names.filter(n=>!['transient','stop'].includes(n));
        const nodes:Options['nodes']=names.map((id,i)=>({id,label:labels[i]!,shape:['confirm','quorum','fenced','eligible','ready'].includes(id)?'diamond':'rect'}));
        const edges:Options['edges']=mainPath.slice(1).map((to,i)=>({from:mainPath[i]!,to,...(nodes.find(n=>n.id===mainPath[i])?.shape==='diamond'?{label:'Да'}:{})}));
        edges.push({from:'confirm',to:'transient',label:'Нет'},...['quorum','fenced','eligible','ready'].map(from=>({from,to:'stop',label:'Нет'})));
        const base=await run({nodes,edges,direction});const compact=await run({nodes,edges,direction,compact:true,mainPath});
        expect(compact.width*compact.height).toBeLessThan(base.width*base.height*0.8);
        const axis=compact.boxes.filter(b=>mainPath.includes(b.id)).map(b=>direction==='down'?b.x+b.width/2:b.y+b.height/2);
        expect(Math.max(...axis)-Math.min(...axis)).toBeLessThan(0.01);
        for(const [i,b] of compact.boxes.entries()){
            expect([b.width,b.height]).toEqual([base.boxes[i]!.width,base.boxes[i]!.height]);
            for(const other of compact.boxes.slice(i+1)) expect(b.x+b.width<=other.x || other.x+other.width<=b.x || b.y+b.height<=other.y || other.y+other.height<=b.y).toBe(true);
        }
        for(const r of compact.routes){
            const a=compact.boxes.find(b=>b.id===r.from)!,b=compact.boxes.find(b=>b.id===r.to)!;
            expect(r.points[0]).toEqual(direction==='down'?{x:a.x+a.width/2,y:a.y+a.height}:{x:a.x+a.width,y:a.y+a.height/2});
            expect(r.points.at(-1)).toEqual(direction==='down'?{x:b.x+b.width/2,y:b.y}:{x:b.x,y:b.y+b.height/2});
            for(let i=1;i<r.points.length;i++){
                const p=r.points[i-1]!,q=r.points[i]!;
                expect(p.x===q.x || p.y===q.y).toBe(true);
                for(const box of compact.boxes.filter(b=>![r.from,r.to].includes(b.id))){
                    const intersects=p.x===q.x ? p.x>box.x && p.x<box.x+box.width && Math.max(p.y,q.y)>box.y && Math.min(p.y,q.y)<box.y+box.height : p.y>box.y && p.y<box.y+box.height && Math.max(p.x,q.x)>box.x && Math.min(p.x,q.x)<box.x+box.width;
                    expect(intersects).toBe(false);
                }
            }
        }
    });
    test('long labels wrap; merge and skip-rank edges route',async()=>{
        const r=await run({nodes:[{id:'a',label:'Очень длинная подпись на русском языке '.repeat(5)},{id:'b',label:'b'},{id:'c',label:'c'},{id:'d',label:'d'}],edges:[{from:'a',to:'b'},{from:'a',to:'c'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'a',to:'d'}]});expect(r.routes).toHaveLength(5);expect(r.svg.match(/<tspan/g)!.length).toBeGreaterThan(4);
    });
});

describe('centered columns',()=>{
    const check = (r:Awaited<ReturnType<typeof run>>, mainPath:string[]) => {
        expect(new Set(r.boxes.map(b=>b.width)).size).toBe(1);
        for(const id of mainPath){const b=r.boxes.find(b=>b.id===id)!;expect(b.x+b.width/2).toBe(r.width/2);}
        for(const edge of r.routes){
            const a=r.boxes.find(b=>b.id===edge.from)!,b=r.boxes.find(b=>b.id===edge.to)!;
            expect(edge.points[0]).toEqual({x:a.x+a.width/2,y:a.y+a.height});
            expect(edge.points.at(-1)).toEqual({x:b.x+b.width/2,y:b.y});
            for(let i=1;i<edge.points.length;i++){
                const p=edge.points[i-1]!,q=edge.points[i]!;
                expect(p.x===q.x||p.y===q.y).toBe(true);
                for(const box of r.boxes){
                    const crosses=p.x===q.x ? p.x>box.x+0.01&&p.x<box.x+box.width-0.01&&Math.max(p.y,q.y)>box.y+0.01&&Math.min(p.y,q.y)<box.y+box.height-0.01 : p.y>box.y+0.01&&p.y<box.y+box.height-0.01&&Math.max(p.x,q.x)>box.x+0.01&&Math.min(p.x,q.x)<box.x+box.width-0.01;
                    expect(crosses).toBe(false);
                }
            }
        }
        const header=r.svg.includes('font-size="20"')?64:18;
        const labels=[...r.svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="6"/g)].map(m=>({x:+m[1]!+16,y:+m[2]!+header,width:+m[3]!,height:+m[4]!}));
        for(const l of labels) for(const b of r.boxes) expect(l.x<b.x+b.width&&l.x+l.width>b.x&&l.y<b.y+b.height&&l.y+l.height>b.y).toBe(false);
        for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i]!,b=labels[j]!;expect(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y).toBe(false);}
    };
    for(const columns of [3,5] as const) test(`${columns} columns aligned with equal widths and safe routes`,async()=>{
        const mainPath=['user','api','access','db'];
        const r=await run({nodes,edges,direction:'down',mainPath,columns,compact:true});check(r,mainPath);
        const centers=[...new Set(r.boxes.map(b=>b.x+b.width/2))].sort((a,b)=>a-b);
        expect(centers).toHaveLength(2);expect(centers[0]).toBe(r.width/2);
    });
    test('invalid column settings and unchanged defaults',async()=>{
        for(const columns of [0,1,2,4,6,'3'])await expect(run({nodes,edges,direction:'down',mainPath:['user','api'],columns} as Options)).rejects.toThrow('columns must');
        await expect(run({nodes,edges,columns:3,mainPath:['user','api']})).rejects.toThrow('direction down');
        await expect(run({nodes,edges,direction:'down',columns:3})).rejects.toThrow('mainPath');
        const a=await run({nodes,edges}),b=await run({nodes,edges,columns:undefined});expect(a.boxes).toEqual(b.boxes);expect(a.routes).toEqual(b.routes);
    });
    for(const theme of ['default','d2-inspired'] as const) for(const columns of [3,5] as const)test(`failover ${columns} columns ${theme}`,async()=>{
        const mainPath=['alert','confirm','quorum','fence','fenced','select','eligible','replay','promote','ready','route','clients','replicas','old','restore'];
        const decisions=new Set(['confirm','quorum','fenced','eligible','ready']);
        const nodes:Options['nodes']=[...mainPath.map(id=>({id,label:id==='confirm'?'Сбой подтверждён? Длинная подпись проверки':id,shape:decisions.has(id)?'diamond' as const:'rect' as const})),{id:'transient',label:'Временный сбой'},{id:'stop',label:'СТОП · ручная проверка',shape:'cylinder'}];
        const edges:Options['edges']=mainPath.slice(1).map((to,i)=>({from:mainPath[i]!,to,label:decisions.has(mainPath[i]!)?'Да':undefined}));
        for(const from of decisions)edges.push({from,to:from==='confirm'?'transient':'stop',label:'Нет'});
        check(await run({nodes,edges,direction:'down',columns,mainPath,compact:true,title:'Failover',theme}),mainPath);
    });
});
describe('flow themes',()=>{
    test('validation, legacy geometry and SVG regression',async()=>{
        await expect(run({nodes,edges,theme:'D2' as Options['theme']})).rejects.toThrow('theme');
        const a=await run({nodes,edges}),b=await run({nodes,edges,theme:'default'});
        expect(a.boxes).toEqual(b.boxes);expect(a.routes).toEqual(b.routes);
        const normalize=(s:string)=>s.replace(/flow-[0-9a-f-]+/g,'flow-id');
        expect(normalize(a.svg)).toBe(normalize(b.svg));
        expect(a.boxes[0]!.height).toBe(64);expect(a.svg).toContain('rx="10"');expect(a.svg).toContain('markerWidth="7"');
    });
    for(const direction of ['down','right'] as const)test('sizing, styling and safe routes '+direction,async()=>{
        const base=await run({nodes,edges,direction});
        const r=await run({nodes,edges,direction,theme:'d2-inspired'});
        for(const [i,b] of r.boxes.entries()){
            expect(b.width).toBeGreaterThan(base.boxes[i]!.width);expect(b.height).toBeGreaterThan(base.boxes[i]!.height);
            for(const o of r.boxes.slice(i+1))expect(b.x+b.width<=o.x||o.x+o.width<=b.x||b.y+b.height<=o.y||o.y+o.height<=b.y).toBe(true);
        }
        for(const route of r.routes){
            const a=r.boxes.find(b=>b.id===route.from)!,b=r.boxes.find(b=>b.id===route.to)!;
            expect(route.points[0]).toEqual(direction==='down'?{x:a.x+a.width/2,y:a.y+a.height}:{x:a.x+a.width,y:a.y+a.height/2});
            expect(route.points.at(-1)).toEqual(direction==='down'?{x:b.x+b.width/2,y:b.y}:{x:b.x,y:b.y+b.height/2});
            for(let i=1;i<route.points.length;i++){
                const p=route.points[i-1]!,q=route.points[i]!;expect(p.x===q.x||p.y===q.y).toBe(true);
                for(const box of r.boxes)if(box.id!==route.from&&box.id!==route.to){
                    const intersects=p.x===q.x?p.x>box.x&&p.x<box.x+box.width&&Math.max(p.y,q.y)>box.y&&Math.min(p.y,q.y)<box.y+box.height:p.y>box.y&&p.y<box.y+box.height&&Math.max(p.x,q.x)>box.x&&Math.min(p.x,q.x)<box.x+box.width;
                    expect(intersects).toBe(false);
                }
            }
        }
        for(const token of ['font-size="16"','font-size="14"','rx="4"','stroke-width="2"','markerWidth="10"','fill="#f8fbff"','height="32"'])expect(r.svg).toContain(token);
        expect(r.svg).toContain('fill="#0d6efd"');expect(r.svg).toContain('stroke="#0d6efd"');
    });
    test('explicit gaps override compact and theme defaults',async()=>{
        const input={nodes:nodes.slice(0,2),edges:edges.slice(0,1),theme:'d2-inspired' as const};
        const standard=await run(input),compact=await run({...input,compact:true});
        const explicit=await run({...input,compact:true,nodeGap:48,layerGap:80});
        expect(standard.boxes[1]!.x-standard.boxes[0]!.x-standard.boxes[0]!.width).toBe(80);
        expect(compact.boxes[1]!.x-compact.boxes[0]!.x-compact.boxes[0]!.width).toBe(32);
        expect(explicit.boxes).toEqual(standard.boxes);
    });
});
test('theme dimensions include measured multiline text and safe diamond inset before layout',async()=>{
    const label='Measured text\nSecond line\nThird line\nFourth line';
    const themed=await run({nodes:[{id:'r',label},{id:'d',label,shape:'diamond'},{id:'c',label,shape:'cylinder'}],edges:[],theme:'d2-inspired'});
    const tw=Math.max(...label.split('\n').map(text=>measureText({} as Context,null,{text,size:16,weight:500}).width*1.08));
    const [r,d,c]=themed.boxes;
    expect(r!.width).toBe(Math.ceil(Math.max(140,tw+56)));expect(r!.height).toBe(4*24+48);
    expect(c!.height).toBe(4*24+64);expect(d!.width).toBe(Math.ceil(Math.max(160,2*(tw+30))));expect(d!.height).toBe(2*(4*24+22));
    // The text rectangle including the inset fits wholly inside the diamond.
    expect((tw+30)/d!.width+(4*24+22)/d!.height).toBeLessThanOrEqual(1.001);
    expect(themed.svg).toContain('dy="72"');
});

describe('explicit shared bundles',()=>{
    test('same target and nonblank names required',async()=>{
        await expect(run({nodes,edges:[{from:'user',to:'api',bundle:'x'},{from:'access',to:'db',bundle:'x'}]})).rejects.toThrow('same target');
        await expect(run({nodes,edges:[{from:'user',to:'api',bundle:' '}]})).rejects.toThrow('bundle must');
    });
    for(const theme of ['default','d2-inspired'] as const)for(const columns of [3,5] as const)test(`shared failover ${theme} columns ${columns}`,async()=>{
        const mainPath=['alert','confirm','quorum','fence','fenced','select','eligible','replay','promote','ready','route','clients','replicas','old','restore'];
        const decisions=new Set(['confirm','quorum','fenced','eligible','ready']);
        const nodes:Options['nodes']=[...mainPath.map(id=>({id,label:id==='confirm'?'Сбой подтверждён? Длинная подпись проверки':id,shape:decisions.has(id)?'diamond' as const:'rect' as const})),{id:'transient',label:'Временный сбой'},{id:'stop',label:'СТОП · ручная проверка',shape:'cylinder'}];
        const edges:Options['edges']=mainPath.slice(1).map((to,i)=>({from:mainPath[i]!,to,label:decisions.has(mainPath[i]!)?'Да':undefined}));
        for(const from of decisions)edges.push({from,to:from==='confirm'?'transient':'stop',label:'Нет',...(from==='confirm'?{}:{bundle:'failure'})});
        const r=await run({nodes,edges,direction:'down',columns,mainPath,compact:true,theme});
        expect(r.bundles).toHaveLength(1);expect(new Set(r.boxes.map(b=>b.width)).size).toBe(1);
        const bundle=r.bundles[0]!;expect(bundle.junctions).toHaveLength(4);expect(bundle.points).toHaveLength(3);
        expect((r.svg.match(/marker-end=/g)??[]).length).toBe(edges.length-4+1);
        const branches=r.routes.filter(e=>e.bundle);expect(branches).toHaveLength(4);
        for(const branch of branches){expect(branch.points).toHaveLength(2);expect(branch.points[0]!.y).toBe(branch.points[1]!.y);expect(branch.points[1]!.x).toBe(bundle.points[0]!.x);expect(bundle.junctions).toContainEqual(branch.points[1]!);}
        for(const route of [...r.routes,...r.bundles])for(let i=1;i<route.points.length;i++){
            const a=route.points[i-1]!,b=route.points[i]!;expect(a.x===b.x||a.y===b.y).toBe(true);
            for(const box of r.boxes){const hit=Math.max(a.x,b.x)>box.x+0.1&&Math.min(a.x,b.x)<box.x+box.width-0.1&&Math.max(a.y,b.y)>box.y+0.1&&Math.min(a.y,b.y)<box.y+box.height-0.1;expect(hit).toBe(false);}
        }
        // Label rectangles use local coordinates; header 18 and left inset 16.
        const labels=[...r.svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="[^"]+" stroke="[^"]+"\/><text/g)].map(m=>({x:+m[1]!+16,y:+m[2]!+18,w:+m[3]!,h:+m[4]!}));
        expect(labels.length).toBe(10);
        for(const label of labels)for(const box of r.boxes)expect(label.x<box.x+box.width&&label.x+label.w>box.x&&label.y<box.y+box.height&&label.y+label.h>box.y).toBe(false);
    });
});

test('bundles transpose to right',async()=>{
    const nodes=['a','b','c','stop'].map(id=>({id,label:id}));
    const edges=[{from:'a',to:'b'},{from:'b',to:'c'},{from:'a',to:'stop',label:'No',bundle:'x'},{from:'b',to:'stop',label:'No',bundle:'x'}];
    const r=await run({nodes,edges,direction:'right',nodeGap:140,mainPath:['a','b','c']});
    expect(r.bundles).toHaveLength(1);
    for(const branch of r.routes.filter(e=>e.bundle)){expect(branch.points.length).toBe(2);expect(branch.points[0]!.x).toBe(branch.points[1]!.x);}
});
