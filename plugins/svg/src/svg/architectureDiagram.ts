/**
 * Render a JSON service architecture with one-level groups and routed links as SVG.
 *
 * Use for small service architectures with optional one-level groups; links connect services, not groups. ELK layered orthogonal routing runs in a local worker. Returns standalone SVG and absolute SVG-space node/group boxes, edge sections and label geometry. IDs encode input IDs and remain stable across input reorder and text changes; separate diagrams should be isolated SVG documents. Limits: 100 nodes, 200 edges, 30 nonnested groups. Labels use estimated text metrics and character wrapping, not browser font measurement. Groups cannot nest; empty groups are supported. No icons or C4 semantics. Dense layouts may cross or share edge segments. No animation.
 * @param opts.nodes Services with unique nonblank IDs up to 128 characters, labels up to 300 characters and optional existing group ID. Empty array is valid.
 * @param opts.edges Directed links with unique IDs up to 128 characters, existing node references and optional single-line labels up to 100 characters. Parallel links and self-loops are supported.
 * @param opts.groups Up to 30 one-level groups with unique IDs distinct from service IDs and single-line labels up to 100 characters. Defaults to no groups.
 * @param opts.direction Primary direction for orthogonal graph layout. @default right
 * @param opts.title Optional accessible and visible heading up to 160 characters; omitted means no visible heading.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Services with unique nonblank IDs up to 128 characters, labels up to 300 characters and optional existing group ID. Empty array is valid. */
        nodes: Array<{id:string;label:string;group?:string}>;
        /** Directed links with unique IDs up to 128 characters, existing node references and optional single-line labels up to 100 characters. Parallel links and self-loops are supported. */
        edges: Array<{id:string;from:string;to:string;label?:string}>;
        /** Up to 30 one-level groups with unique IDs distinct from service IDs and single-line labels up to 100 characters. Defaults to no groups. */
        groups?: Array<{id:string;label:string}>;
        /** Primary direction for orthogonal graph layout. @default right */
        direction?: 'right'|'down';
        /** Optional accessible and visible heading up to 160 characters; omitted means no visible heading. */
        title?: string;
    },
): Promise<{svg:string;width:number;height:number;boxes:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>;groups:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>;routes:Array<{id:string;elementId:string;from:string;to:string;sections:Array<Array<{x:number;y:number}>>;labels:Array<{text:string;x:number;y:number;width:number;height:number}>}>;engine:'elk-layered'}> {
    const direction = opts.direction ?? 'right';
        if (!['right','down'].includes(direction)) throw new Error('direction must be right or down');
        const text = (v: string, max: number, field: string) => { if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(v) || !v.isWellFormed()) throw new Error('Invalid '+field); };
        const ident = (v: string) => { text(v,128,'id'); if (!v.trim()) throw new Error('Blank id'); };
        if (!Array.isArray(opts.nodes) || opts.nodes.length > 100) throw new Error('At most 100 nodes required');
        if (!Array.isArray(opts.edges) || opts.edges.length > 200) throw new Error('At most 200 edges required');
        if (opts.title !== undefined) text(opts.title,160,'title');
        const nodeIds = new Set<string>(), edgeIds = new Set<string>();
        for (const n of opts.nodes) { if (!n) throw new Error('Invalid node'); ident(n.id); if(nodeIds.has(n.id)) throw new Error('Duplicate node id'); nodeIds.add(n.id); text(n.label,300,'node label'); if(n.group!==undefined) ident(n.group); }
        for (const e of opts.edges) { if (!e) throw new Error('Invalid edge'); ident(e.id); if(edgeIds.has(e.id)) throw new Error('Duplicate edge id'); edgeIds.add(e.id); if(!nodeIds.has(e.from)||!nodeIds.has(e.to)) throw new Error('Unknown edge reference'); if(e.label !== undefined) {text(e.label,100,'edge label'); if(e.label.includes('\n')) throw new Error('Edge labels must be single-line');} }
        const groupIds=new Set<string>(); if(opts.groups!==undefined&&(!Array.isArray(opts.groups)||opts.groups.length>30))throw new Error('At most 30 groups');for(const g of opts.groups??[]){if(!g)throw new Error('Invalid group');ident(g.id);text(g.label,100,'group label');if(g.label.includes('\n'))throw new Error('Group labels must be single-line');if(groupIds.has(g.id)||nodeIds.has(g.id))throw new Error('Duplicate group id');groupIds.add(g.id);}for(const n of opts.nodes)if(n.group!==undefined&&!groupIds.has(n.group))throw new Error('Unknown group');
        const esc = (s:string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
        // Injective Unicode-codepoint encoding gives IDs stable across reorder and label edits.
        const eid = (kind:string,id:string) => 'architectureDiagram-'+kind+'-'+Array.from(id,c=>c.codePointAt(0)!.toString(16)).join('-');
        const measure = (s:string,size=14) => ctx.fns.svg.measureText({text:s,size,weight:500}).width*1.08;
        const linesById = new Map<string,string[]>();
        for(const n of opts.nodes){const lines:string[]=[];for(const paragraph of n.label.split('\n')){let line='';for(const ch of paragraph){if(line&&measure(line+ch)>220){lines.push(line.trimEnd());line='';}line+=ch;}lines.push(line.trimEnd());}linesById.set(n.id,lines);}
        const children:import('elkjs').ElkNode[] = opts.nodes.map(n=>{ const lines=linesById.get(n.id)!; const special=false; return {id:eid('node',n.id),width:special?24:Math.ceil(Math.max(120,...lines.map(s=>measure(s)+40))),height:special?24:Math.max(64,lines.length*20+32)}; });
        const groupOriginal=new Map((opts.groups??[]).map(g=>[eid('group',g.id),g.id]));const groupLabels=new Map((opts.groups??[]).map(g=>[g.id,g.label])); const rootChildren:import('elkjs').ElkNode[]=[...children.filter((_,i)=>!opts.nodes[i]!.group),...(opts.groups??[]).map(g=>({id:eid('group',g.id),width:Math.max(160,measure(g.label,13)+48),height:100,labels:[{text:g.label,width:measure(g.label,13),height:20,layoutOptions:{'elk.nodeLabels.placement':'INSIDE H_LEFT V_TOP'}}],layoutOptions:{'elk.padding':'[top=56,left=28,bottom=28,right=28]'},children:children.filter((_,i)=>opts.nodes[i]!.group===g.id)}))];
        const {resolve}=await import('node:path');
        const {default:ELK}=await import(resolve(import.meta.dir,'../../node_modules/elkjs/lib/main.js')) as typeof import('elkjs');
        const elk=new ELK({workerFactory:()=>new Worker(resolve(import.meta.dir,'../../node_modules/elkjs/lib/elk-worker.min.js'))});
        const layout=await elk.layout<import('elkjs').ElkNode>({id:'root',layoutOptions:{'elk.algorithm':'layered','elk.direction':direction==='right'?'RIGHT':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.hierarchyHandling':'INCLUDE_CHILDREN','elk.padding':'[top=28,left=28,bottom=28,right=28]','elk.spacing.nodeNode':'48','elk.layered.spacing.nodeNodeBetweenLayers':'72','elk.spacing.edgeNode':'24','elk.spacing.edgeEdge':'16','elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES'},children:rootChildren,edges:opts.edges.map(e=>({id:eid('edge',e.id),sources:[eid('node',e.from)],targets:[eid('node',e.to)],labels:e.label?[{text:e.label,width:Math.ceil(measure(e.label,12)+16),height:24}]:[]}))}).finally(()=>elk.terminateWorker());
        const header=opts.title?72:16;
        const width=Math.ceil(Math.max(240,(layout.width??0)+32,opts.title?measure(opts.title,20)+64:0)),height=Math.ceil(Math.max(120,(layout.height??0)+header+16));
        const finite=(...v:number[])=>{if(v.some(x=>!Number.isFinite(x)||x<0||x>1000000))throw new Error('Invalid layout geometry');};finite(width,height);
        const boxes:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>=[];
        const groups:Array<{id:string;elementId:string;x:number;y:number;width:number;height:number}>=[];
        const routes:Array<{id:string;elementId:string;from:string;to:string;sections:Array<Array<{x:number;y:number}>>;labels:Array<{text:string;x:number;y:number;width:number;height:number}>}>=[];
        const inputNodes=new Map(opts.nodes.map(n=>[eid('node',n.id),n])); const inputEdges=new Map(opts.edges.map(e=>[eid('edge',e.id),e]));
        const collect=(graph:import('elkjs').ElkNode,ox:number,oy:number)=>{
          for(const n of graph.children??[]){const x=ox+(n.x??0),y=oy+(n.y??0),w=n.width??0,h=n.height??0;finite(x,y,w,h);const original=inputNodes.get(n.id);const box={id:original?.id??groupOriginal.get(n.id)!,elementId:n.id,x,y,width:w,height:h};if(original)boxes.push(box);else groups.push(box);collect(n,x,y);}
          for(const e of graph.edges??[]){const container=(e as import('elkjs').ElkExtendedEdge & {container?:string}).container; const parent=container&&container!=='root'?groups.find(g=>g.elementId===container):undefined; if(container&&container!=='root'&&!parent)throw new Error('Unknown edge coordinate container');const ex=parent?.x??ox,ey=parent?.y??oy;const original=inputEdges.get(e.id);if(!original)throw new Error('Unexpected layout edge');if(!e.sections?.length)throw new Error('Unrouted edge');const sections=e.sections.map(s=>[s.startPoint,...s.bendPoints??[],s.endPoint].map(p=>{const point={x:ex+p.x,y:ey+p.y};finite(point.x,point.y);return point;}));const labels=(e.labels??[]).map(l=>{const label={text:l.text??'',x:ex+(l.x??0),y:ey+(l.y??0),width:l.width??0,height:l.height??0};finite(label.x,label.y,label.width,label.height);return label;});routes.push({id:original.id,elementId:e.id,from:original.from,to:original.to,sections,labels});}
        }; collect(layout,16,header);
        if(boxes.length!==opts.nodes.length||routes.length!==opts.edges.length)throw new Error('Incomplete layout');
        const scope='architectureDiagram-'+Bun.randomUUIDv7();const arrow=scope+'-arrow',titleId=scope+'-title';
        const out=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId}"><title id="${titleId}">${esc(opts.title??'Architecture diagram')}</title><defs><marker id="${arrow}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#85858d"/></marker></defs><rect width="${width}" height="${height}" fill="#ffffff"/><g font-family="Inter,Arial,sans-serif">`];
        if(opts.title)out.push(`<path d="M 32 22 H 60" stroke="#6384d5" stroke-width="3"/><text x="32" y="52" fill="#27272a" font-size="20" font-weight="600">${esc(opts.title)}</text>`);
        for(const g of groups)out.push(`<g id="${g.elementId}" data-group-id="${esc(g.id)}"><rect x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" rx="8" fill="#ffffff" stroke="#d4d4d8" stroke-width="1"/><text x="${g.x+20}" y="${g.y+26}" font-size="13" font-weight="600" fill="#71717a">${esc(groupLabels.get(g.id)!)}</text></g>`);
        for(const e of routes){out.push(`<g id="${e.elementId}" data-edge-id="${esc(e.id)}">`);for(const ps of e.sections)out.push(`<path d="${ps.map((p,i)=>(i?'L':'M')+' '+p.x+' '+p.y).join(' ')}" fill="none" stroke="#85858d" stroke-width="1" stroke-linejoin="round" marker-end="url(#${arrow})"/>`);for(const l of e.labels)out.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" fill="#ffffff"/><text x="${l.x+l.width/2}" y="${l.y+16}" text-anchor="middle" fill="#71717a" font-size="12">${esc(l.text)}</text>`);out.push('</g>');}
        for(const b of boxes){const n=inputNodes.get(b.elementId)!;out.push(`<g id="${b.elementId}" data-node-id="${esc(b.id)}"><title>${esc(n.label)}</title>`);out.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="6" fill="#f7f7f8" stroke="#d4d4d8" stroke-width="1"/><text text-anchor="middle" fill="#27272a" font-size="14" font-weight="500">`); const lines=linesById.get(n.id)!;lines.forEach((line,i)=>out.push(`<tspan x="${b.x+b.width/2}" y="${b.y+b.height/2-(lines.length-1)*10+5+i*20}">${esc(line)}</tspan>`));out.push('</text>'); out.push('</g>');}
        out.push('</g></svg>');return {svg:out.join(''),width,height,boxes,groups,routes,engine:'elk-layered' as const};
}
