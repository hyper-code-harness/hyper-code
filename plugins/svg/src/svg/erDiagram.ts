/**
 * Render JSON entities, fields and cardinality relationships as an SVG entity relationship diagram.
 *
 * Use for general ER graphs including cycles, parallel edges, self-relations and disconnected entities. Fields have explicit PK/FK flags; relationships connect entities and never infer foreign keys. Cardinality labels are explicit at both endpoints (1, 0..1, 0..*, 1..*). ELK (default) provides orthogonal layout in a terminated worker. Optional ACA uses native Adaptagrams incremental alignment followed by obstacle-avoiding orthogonal routing; it requires hola-graph==0.1.5 in ~/.hyper/deps/svg/hola-graph-0.1.5, supports at most 60 entities and simple undirected graphs, and never falls back. ACA routes may cross or share segments; relationship labels are placed on the longest segment without collision avoidance. Text uses conservative fixed character wrapping, not font measurement. Returns stable input-derived element IDs, entity and field boxes, route sections and label geometry. Limits: 80 entities, 160 relationships, 60 fields per entity, 1000 fields total. Empty input gives a blank canvas. Dense graphs may have shared routes or overlapping endpoint labels; no animation. Repeated identical diagrams have identical DOM IDs; namespace externally when inlining duplicates.
 * @param opts.entities Ordered entities with unique nonblank IDs (128 chars), optional labels (300 chars) and ordered fields. Field IDs must be unique within an entity (128 chars); names up to 200 chars, types up to 100 chars. PK and FK flags are independent, false by default. Control characters are rejected.
 * @param opts.relationships Relationships with unique IDs up to 128 chars and from/to entity references. Cardinality at each endpoint is required; label up to 160 chars. Parallel and self relationships are supported only with ELK.
 * @param opts.direction Primary ELK layout direction. @default right
 * @param opts.title Optional single-line heading and accessible title up to 160 characters.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ordered entities with unique nonblank IDs (128 chars), optional labels (300 chars) and ordered fields. Field IDs must be unique within an entity (128 chars); names up to 200 chars, types up to 100 chars. PK and FK flags are independent, false by default. Control characters are rejected. */
        entities: Array<{id: string; label?: string; fields: Array<{id: string; name: string; type?: string; pk?: boolean; fk?: boolean}>}>;
        /** Relationships with unique IDs up to 128 chars and from/to entity references. Cardinality at each endpoint is required; label up to 160 chars. Parallel and self relationships are supported only with ELK. */
        relationships: Array<{id: string; from: string; to: string; fromCardinality: "0..1" | "1" | "0..*" | "1..*"; toCardinality: "0..1" | "1" | "0..*" | "1..*"; label?: string}>;
        /** Layout engine: ELK layered or native Adaptagrams ACA with orthogonal routing. ACA requires a simple undirected graph and at most 60 entities; missing native dependencies produce installation instructions. @default elk */
        layout?: "elk" | "aca";
        /** Primary ELK layout direction; ignored by ACA. @default right */
        direction?: "right" | "down";
        /** Optional single-line heading and accessible title up to 160 characters. */
        title?: string;
        /** Minimum node separation in SVG pixels. ELK uses same-layer spacing (default 90); ACA inflates boxes (default 32) and may increase it for edge clearance. @default 90 @minimum 0 @maximum 500 */
        nodeGap?: number;
        /** ELK-only minimum gap between successive layers, in SVG pixels; ignored by ACA. ELK may enlarge it for labels. @default 140 @minimum 0 @maximum 500 */
        layerGap?: number;
        /** Edge-to-node clearance in SVG pixels: ELK default 40, ACA default 12. ACA routing requires at least 1 pixel (zero requests 1). @default 40 @minimum 0 @maximum 200 */
        edgeGap?: number;
    },
): Promise<{svg: string; width: number; height: number; boxes: Array<{id: string; elementId: string; x: number; y: number; width: number; height: number; fields: Array<{id: string; elementId: string; x: number; y: number; width: number; height: number}>}>; routes: Array<{id: string; elementId: string; from: string; to: string; sections: Array<Array<{x: number; y: number}>>; cardinalities: Array<{elementId: string; text: string; x: number; y: number}>; labels: Array<{elementId: string; x: number; y: number; width: number; height: number}>}>; engine: "elk-layered" | "aca"}> {
    const fail = (s: string): never => { throw new Error('erDiagram: ' + s); };
    const text = (v: string, max: number, what: string) => { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f-\u009f\ufffe\uffff\ud800-\udfff]/u.test(v)) fail('invalid ' + what); };
    const keys = (v: object, allowed: string[]) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k=>!allowed.includes(k))) fail('unknown or invalid properties'); };
    keys(opts,['entities','relationships','layout','direction','title','nodeGap','layerGap','edgeGap']);
    const engine = opts.layout ?? 'elk';
    if (!['elk','aca'].includes(engine)) fail('invalid layout; expected elk or aca');
    const nodeGap = opts.nodeGap ?? (engine==='aca'?32:90), layerGap = opts.layerGap ?? 140, edgeGap = opts.edgeGap ?? (engine==='aca'?12:40);
    for (const [name,value,max] of [['nodeGap',nodeGap,500],['layerGap',layerGap,500],['edgeGap',edgeGap,200]] as const) {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(name + ' must be finite between 0 and ' + max);
    }
    if (!Array.isArray(opts.entities) || opts.entities.length > 80) fail('entities limit is 80');
    if (!Array.isArray(opts.relationships) || opts.relationships.length > 160) fail('relationships limit is 160');
    const direction = opts.direction ?? 'right'; if (!['right','down'].includes(direction)) fail('invalid direction');
    if (opts.title !== undefined) text(opts.title,160,'title');
    const ids = new Set<string>(); let total = 0;
    for (const e of opts.entities) {
     keys(e,['id','label','fields']); text(e.id,128,'entity id'); if(ids.has(e.id)) fail('duplicate entity id'); ids.add(e.id); if(e.label!==undefined) text(e.label,300,'entity label');
     if(!Array.isArray(e.fields)||e.fields.length>60) fail('fields limit is 60 per entity'); total += e.fields.length;
     const fs = new Set<string>(); for(const f of e.fields){ keys(f,['id','name','type','pk','fk']); text(f.id,128,'field id'); if(fs.has(f.id)) fail('duplicate field id');fs.add(f.id);text(f.name,200,'field name');if(f.type!==undefined)text(f.type,100,'field type');if(f.pk!==undefined && typeof f.pk!=='boolean' || f.fk!==undefined && typeof f.fk!=='boolean')fail('key flags must be boolean'); }
    }
    if(total>1000)fail('total fields limit is 1000');
    const rs = new Set<string>();
    for(const r of opts.relationships){keys(r,['id','from','to','fromCardinality','toCardinality','label']);text(r.id,128,'relationship id');if(rs.has(r.id))fail('duplicate relationship id');rs.add(r.id);if(!ids.has(r.from)||!ids.has(r.to))fail('unknown relationship entity');for(const c of [r.fromCardinality,r.toCardinality])if(!['0..1','1','0..*','1..*'].includes(c))fail('invalid cardinality');if(r.label!==undefined)text(r.label,160,'relationship label');}
    if(engine==='aca') {
        if(opts.entities.length>60) fail('ACA supports at most 60 entities; use layout: "elk" for larger graphs');
        const pairs=new Set<string>();
        for(const r of opts.relationships){const pair=JSON.stringify([r.from,r.to].sort());if(r.from===r.to||pairs.has(pair))fail('ACA requires a simple undirected graph: self and parallel relationships (including reversed pairs) are unsupported; use layout: "elk"');pairs.add(pair);}
    }
    const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const enc=(s:string)=>Array.from(s).map(c=>c.codePointAt(0)!.toString(16)).join('_');
    const element=(kind:string,id:string)=>'er-'+kind+'-'+enc(id);
    const wrap=(s:string,n:number)=>{const a=Array.from(s);return Array.from({length:Math.max(1,Math.ceil(a.length/n))},(_,i)=>a.slice(i*n,(i+1)*n).join(''));};
    // Conservative text advances, consistent with the fixed-character wrapping above.
    const lineWidth=(lines:string[],size:number)=>Math.max(0,...lines.map(line=>Array.from(line).reduce((sum,ch)=>sum+size*(/[\u2e80-\u9fff]/u.test(ch)?1:0.68),0)));
    const models=opts.entities.map(e=>{
        const header=wrap(e.label??e.id,32),hh=header.length*20+26;let y=hh;
        const fields=e.fields.map(f=>{const names=wrap(f.name,21),types=wrap(f.type??'',14),height=Math.max(names.length,types.length)*18+18;const m={f,names,types,y,height};y+=height;return m;});
        const nameWidth=Math.max(0,...fields.map(f=>lineWidth(f.names,13)));
        const typeWidth=Math.max(0,...fields.map(f=>lineWidth(f.types,12)));
        const badgeWidth=Math.max(0,...fields.map(f=>lineWidth([[f.f.pk?'PK':'',f.f.fk?'FK':''].filter(Boolean).join(' ')],10)));
        const typeX=16+nameWidth+20;
        const contentWidth=fields.length?typeX+typeWidth+(badgeWidth?20+badgeWidth:0)+16:0;
        return {e,header,hh,fields,typeX,width:Math.ceil(Math.max(96,lineWidth(header,15)+32,contentWidth)),height:y};
    });
    let layout: import('elkjs').ElkNode;
    if(engine==='aca') {
        const clearance=Math.max(1,edgeGap), padding=Math.max(nodeGap,clearance*2+2);
        // Inflate before native alignment, then shrink back to content-sized boxes.
        const aligned=await ctx.fns.svg.layoutIncremental({nodes:models.map(m=>({id:m.e.id,w:m.width+padding,h:m.height+padding})),edges:opts.relationships.map(r=>({id:r.id,from:r.from,to:r.to}))});
        const nativeBoxes=aligned.boxes.map(b=>({id:b.id,x:b.x+padding/2,y:b.y+padding/2,w:b.w-padding,h:b.h-padding}));
        const routed=await ctx.fns.svg.routeEdges({boxes:nativeBoxes,edges:opts.relationships.map(r=>({id:r.id,from:r.from,to:r.to})),gap:clearance,gridSize:0});
        const labels=routed.map(route=>{const r=opts.relationships.find(r=>r.id===route.id)!;if(!r.label)return [];const segments=route.points.slice(1).map((p,i)=>({p,q:route.points[i]!,length:Math.abs(p.x-route.points[i]!.x)+Math.abs(p.y-route.points[i]!.y)})).sort((a,b)=>b.length-a.length);const s=segments[0]!,width=Math.min(40,Array.from(r.label).length)*8+16,height=wrap(r.label,40).length*18+12;return [{id:element('label',r.id),text:r.label,x:(s.p.x+s.q.x-width)/2,y:(s.p.y+s.q.y-height)/2,width,height}];});
        const xs=[0,...nativeBoxes.flatMap(b=>[b.x,b.x+b.w]),...routed.flatMap(r=>r.points.map(p=>p.x)),...labels.flat().flatMap(l=>[l.x,l.x+l.width])],ys=[0,...nativeBoxes.flatMap(b=>[b.y,b.y+b.h]),...routed.flatMap(r=>r.points.map(p=>p.y)),...labels.flat().flatMap(l=>[l.y,l.y+l.height])];
        const dx=48-Math.min(...xs),dy=48-Math.min(...ys);
        layout={id:'root',width:Math.max(...xs)+dx+48,height:Math.max(...ys)+dy+48,children:nativeBoxes.map(b=>({id:element('entity',b.id),x:b.x+dx,y:b.y+dy,width:b.w,height:b.h})),edges:routed.map((r,i)=>{const rel=opts.relationships.find(e=>e.id===r.id)!,points=r.points.map(p=>({x:p.x+dx,y:p.y+dy}));return {id:element('relationship',r.id),sources:[element('entity',rel.from)],targets:[element('entity',rel.to)],sections:[{id:element('section',r.id),startPoint:points[0]!,endPoint:points.at(-1)!,bendPoints:points.slice(1,-1)}],labels:labels[i]!.map(l=>({...l,x:l.x+dx,y:l.y+dy}))};})};
    } else {
    const {resolve}=await import('node:path');
    const {default:ELK}=await import(resolve(import.meta.dir,'../../node_modules/elkjs/lib/main.js')) as typeof import('elkjs');
    const elk=new ELK({workerFactory:()=>new Worker(resolve(import.meta.dir,'../../node_modules/elkjs/lib/elk-worker.min.js'))});
    layout=await elk.layout<import('elkjs').ElkNode>({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':direction==='right'?'RIGHT':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.padding':'[top=48,left=48,bottom=48,right=48]','elk.spacing.nodeNode':String(nodeGap),'elk.layered.spacing.nodeNodeBetweenLayers':String(layerGap),'elk.spacing.edgeNode':String(edgeGap),'elk.spacing.edgeEdge':'30','elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES'},children:models.map(m=>({id:element('entity',m.e.id),width:m.width,height:m.height})),edges:opts.relationships.map(r=>({id:element('relationship',r.id),sources:[element('entity',r.from)],targets:[element('entity',r.to)],labels:r.label?[{id:element('label',r.id),text:r.label,width:Math.min(40,Array.from(r.label).length)*8+16,height:wrap(r.label,40).length*18+12}]:[]}))}).finally(()=>elk.terminateWorker());
    }
    const number=(n:number|undefined)=>{if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>1000000)fail('invalid layout geometry');return n as number;};
    const offset=opts.title?76:12, width=Math.ceil(Math.max(240,number(layout.width??0)+24,(opts.title?.length??0)*11+64)),height=Math.ceil(Math.max(120,number(layout.height??0)+offset+12));
    const boxes:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number;fields:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>}>=[];
    const routes:Array<{id:string;elementId:string;from:string;to:string;sections:Array<Array<{x:number;y:number}>>;cardinalities:Array<{elementId:string;text:string;x:number;y:number}>;labels:Array<{elementId:string;x:number;y:number;width:number;height:number}>}>=[];
    const fragments=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(opts.title??'Entity relationship diagram')}"><title>${esc(opts.title??'Entity relationship diagram')}</title><rect width="${width}" height="${height}" fill="#ffffff"/><g font-family="Inter,Arial,sans-serif" font-size="13" fill="#27272a">`];
    if(opts.title)fragments.push(`<rect x="32" y="20" width="28" height="3" fill="#6384d5"/><text x="32" y="51" font-size="20" font-weight="600">${esc(opts.title)}</text>`);
    const multiline=(lines:string[],x:number,y:number,size=13,color='#27272a')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${lines.map((s,i)=>`<tspan x="${x}" dy="${i?18:0}">${esc(s)}</tspan>`).join('')}</text>`;
    const overlays:string[]=[];
    for(const edge of layout.edges??[]){const r=opts.relationships.find(r=>element('relationship',r.id)===edge.id)!;if(!edge.sections?.length)fail('unrouted relationship');const sections=edge.sections!.map(s=>[s.startPoint,...(s.bendPoints??[]),s.endPoint].map(p=>({x:number(p.x)+12,y:number(p.y)+offset})));const cardinalities:Array<{elementId:string;text:string;x:number;y:number}>=[];const labels:Array<{elementId:string;x:number;y:number;width:number;height:number}>=[];
     fragments.push(`<g id="${edge.id}" data-edge-id="${esc(r.id)}">`);for(const points of sections)fragments.push(`<path d="${points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')}" fill="none" stroke="#85858d" stroke-width="1.2" stroke-linejoin="round"/>`);fragments.push('</g>');
     const first=sections[0]!,last=sections.at(-1)!;
     for(const [end,ps,c] of [['from',first,r.fromCardinality],['to',[...last].reverse(),r.toCardinality]] as const){const p=ps[0]!,q=ps.find(q=>q.x!==p.x||q.y!==p.y);if(!q)fail('zero length relationship');const dx=q!.x-p.x,dy=q!.y-p.y,d=Math.hypot(dx,dy),step=Math.min(30,d/2),x=p.x+dx/d*step-dy/d*14,y=p.y+dy/d*step+dx/d*14;const elementId=edge.id+'-'+end;cardinalities.push({elementId,text:c,x,y});overlays.push(`<g id="${elementId}"><rect x="${x-19}" y="${y-10}" width="38" height="18" rx="3" fill="#ffffff"/><text x="${x}" y="${y+3}" text-anchor="middle" font-size="11" fill="#71717a">${esc(c)}</text></g>`);}
     for(const l of edge.labels??[]){const x=number(l.x)+12,y=number(l.y)+offset,w=number(l.width),h=number(l.height);labels.push({elementId:element('label',r.id),x,y,width:w,height:h});overlays.push(`<g id="${element('label',r.id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#ffffff"/>${multiline(wrap(r.label!,40),x+8,y+18,12,'#71717a')}</g>`);}
     routes.push({id:r.id,elementId:edge.id,from:r.from,to:r.to,sections,cardinalities,labels});
    }
    for(const n of layout.children??[]){const m=models.find(m=>element('entity',m.e.id)===n.id)!,x=number(n.x)+12,y=number(n.y)+offset,w=number(n.width),h=number(n.height);const fields=m.fields.map(f=>({id:f.f.id,elementId:n.id+'-field-'+enc(f.f.id),x,y:y+f.y,width:w,height:f.height}));boxes.push({id:m.e.id,elementId:n.id,x,y,width:w,height:h,fields});fragments.push(`<g id="${n.id}" data-node-id="${esc(m.e.id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#ffffff" stroke="#d4d4d8"/><rect x="${x+1}" y="${y+1}" width="${w-2}" height="${m.hh-1}" rx="3" fill="#f7f7f8"/>${multiline(m.header,x+16,y+25,15)}`);
     for(const [i,f] of m.fields.entries()){const yy=y+f.y;fragments.push(`<g id="${fields[i]!.elementId}" data-field-id="${esc(f.f.id)}"><path d="M ${x} ${yy} H ${x+w}" stroke="#d4d4d8" stroke-width="0.7"/>${multiline(f.names,x+16,yy+22)}${multiline(f.types,x+m.typeX,yy+22,12,'#71717a')}<text x="${x+w-12}" y="${yy+22}" text-anchor="end" font-size="10" fill="#6384d5">${[f.f.pk?'PK':'',f.f.fk?'FK':''].filter(Boolean).join(' ')}</text></g>`);}fragments.push('</g>');}
    fragments.push(...overlays,'</g></svg>');return {svg:fragments.join(''),width,height,boxes,routes,engine:engine==='aca'?'aca':'elk-layered'};
}
