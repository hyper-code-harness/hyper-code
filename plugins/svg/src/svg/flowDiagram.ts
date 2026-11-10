/**
 * Render a directed acyclic JSON graph as a content-sized SVG flowchart using ELK orthogonal layout.
 *
 * Use for small flowcharts with process rectangles, decision diamonds and storage cylinders. ELK places nodes and routes edges using fixed center ports on shape boundaries. Supports disconnected DAGs; rejects cycles, self-loops and parallel edges. Limits: 100 nodes, 200 edges. Node text wraps using estimated Helvetica metrics, not exact font measurement. Dense graphs can have crossings or shared edge segments. Returns standalone SVG, dimensions, boxes and route points in SVG coordinates. Requires only the pinned local elkjs dependency; no browser or service.
 * @param opts.nodes Ordered nodes with unique nonblank IDs up to 128 characters and labels up to 300 characters. Shape defaults to rect; empty array gives an empty canvas.
 * @param opts.edges Directed edges referencing node IDs; no duplicate source-target pairs. Optional single-line labels up to 100 characters. Optional bundle groups a shared obstacle-aware side trunk to one target; member routes end at junctions and bundles return the shared trunk. Unsupported blocked geometry throws; down and transposed right are supported.
 * @param opts.direction Primary graph layout direction. @default right
 * @param opts.theme Visual and pre-layout sizing preset. d2-inspired uses larger text, padding and heavier blue outlines; not the D2 engine or an exact D2 theme. ibm-inspired uses 8px size increments, 16px padding and 14/18 type; an independent interpretation, not IBM assets or exact grid-compliant routing. Explicit gaps override theme defaults; compact uses the preset's compact gaps. @default default
 * @param opts.title Optional heading and accessible title, up to 160 characters.
 * @param opts.compact Reduce node and routing gaps without shrinking text or shapes. Explicit gaps override this preset. @default false
 * @param opts.nodeGap Minimum spacing between nodes in the same layer, in pixels. Defaults to 40 (48 for d2-inspired), or 24 with compact (32 for d2-inspired). @minimum 12 @maximum 200
 * @param opts.layerGap Minimum spacing between adjacent layers, in pixels; labels and routing may require more. Defaults to 64 (80 for d2-inspired), or 24 with compact (32 for d2-inspired). @minimum 12 @maximum 200
 * @param opts.columns Reserve 3 or 5 centered equal-width columns. Requires direction down and mainPath; rejects nonstraight axes, overlapping column projections or insufficient side lanes. Routes and labels are transformed together by expanding empty strips. Unused side columns remain reserved; branches are not mirrored.
 * @param opts.mainPath Ordered IDs of a connected path to favor as a straight axis: vertical for down, horizontal for right. Uses ELK edge priorities and one-sided BK placement before routing; not a hard constraint or canvas centering guarantee.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ordered nodes with unique nonblank IDs up to 128 characters and labels up to 300 characters. Shape defaults to rect; empty array gives an empty canvas. */
        nodes: Array<{ id: string; label: string; shape?: "rect" | "diamond" | "cylinder" }>;
        /** Directed edges referencing node IDs; no duplicate source-target pairs. Optional single-line labels up to 100 characters. Optional bundle groups a shared obstacle-aware side trunk to one target; member routes end at junctions and bundles return the shared trunk. Unsupported blocked geometry throws; down and transposed right are supported. */
        edges: Array<{ from: string; to: string; label?: string; bundle?: string }>;
        /** Primary graph layout direction. @default right */
        direction?: "right" | "down";
        /** Visual and pre-layout sizing preset. ibm-inspired uses 8px size increments, 16px padding, 14/18 node type and 12/16 labels; an independent interpretation, not IBM assets or exact compliance. @default default */
        theme?: "default" | "d2-inspired" | "ibm-inspired";
        /** Optional heading and accessible title, up to 160 characters. */
        title?: string;
        /** Reduce node and routing gaps without shrinking text or shapes. Explicit gaps override this preset. @default false */
        compact?: boolean;
        /** Minimum spacing between nodes in the same layer, in pixels. Defaults to 40 (48 for d2-inspired), or 24 with compact (32 for d2-inspired). @minimum 12 @maximum 200 */
        nodeGap?: number;
        /** Minimum spacing between adjacent layers, in pixels; labels and routing may require more. Defaults to 64 (80 for d2-inspired), or 24 with compact (32 for d2-inspired). @minimum 12 @maximum 200 */
        layerGap?: number;
        /** Ordered IDs of a connected path to favor as a straight axis: vertical for down, horizontal for right. Uses ELK edge priorities and one-sided BK placement before routing; not a hard constraint or canvas centering guarantee. */
        mainPath?: string[];
        /** Reserve equal-width centered columns for down layouts with a straight mainPath. Rejects layouts needing more side lanes or overlapping column projections. All node widths are equal in this mode. */
        columns?: 3 | 5;
    },
): Promise<{ svg: string; width: number; height: number; boxes: Array<{ id: string; x: number; y: number; width: number; height: number }>; bundles: Array<{ id: string; to: string; points: Array<{ x: number; y: number }>; junctions: Array<{ x: number; y: number }> }>; routes: Array<{ from: string; to: string; bundle?: string; points: Array<{ x: number; y: number }> }>; engine: "elk-layered" }> {
    const direction = opts.direction ?? 'right';
    if (opts.columns !== undefined && opts.columns !== 3 && opts.columns !== 5) throw new Error('columns must be 3 or 5');
    if (opts.columns !== undefined && (direction !== 'down' || !opts.mainPath)) throw new Error('columns requires direction down and mainPath');
    if (opts.compact !== undefined && typeof opts.compact !== 'boolean') throw new Error('compact must be boolean');
    if (opts.theme !== undefined && !['default','d2-inspired','ibm-inspired'].includes(opts.theme)) throw new Error('theme must be default, d2-inspired or ibm-inspired');
    // All drawing and measurement roles live here; never recolor serialized SVG.
    const themes = {
        'ibm-inspired': {font:14,line:18,wrap:224,padX:16,padY:16,diamondX:24,diamondY:16,cylinderPad:24,minW:128,minH:48,diamondW:144,diamondH:96,radius:8,border:1,connector:1,arrow:8,labelFont:12,labelLine:16,labelX:8,labelY:8,labelRadius:0,nodeGap:48,layerGap:64,compactGap:32,edgeGap:24,edgeLayerGap:32,compactEdgeGap:16,ink:'#161616',heading:'#161616',edge:'#525252',accent:'#0f62fe',rectFill:'#edf5ff',rectStroke:'#0f62fe',diamondFill:'#f6f2ff',diamondStroke:'#8a3ffc',cylinderFill:'#defbe6',cylinderStroke:'#198038',capFill:'#f3fcf6',labelFill:'#ffffff',labelStroke:'#ffffff',labelInk:'#393939'},
        default: {font:14,line:20,wrap:200,padX:22,padY:18,diamondX:24,diamondY:16,cylinderPad:26,minW:116,minH:64,diamondW:136,diamondH:100,radius:10,border:1,connector:1.5,arrow:7,labelFont:12,labelLine:18,labelX:10,labelY:4,labelRadius:6,nodeGap:40,layerGap:64,compactGap:24,edgeGap:20,edgeLayerGap:24,compactEdgeGap:12,ink:'#2d3b50',heading:'#263449',edge:'#8493a5',accent:'#6384d5',rectFill:'#f5f7fb',rectStroke:'#cdd6e4',diamondFill:'#fff9ed',diamondStroke:'#decca3',cylinderFill:'#edf6f3',cylinderStroke:'#b2cfc3',capFill:'#f6fbf9',labelFill:'#fff',labelStroke:'#e7ecf2',labelInk:'#526176'},
        'd2-inspired': {font:16,line:24,wrap:224,padX:28,padY:24,diamondX:30,diamondY:22,cylinderPad:32,minW:140,minH:80,diamondW:160,diamondH:120,radius:4,border:2,connector:2,arrow:10,labelFont:14,labelLine:20,labelX:12,labelY:6,labelRadius:3,nodeGap:48,layerGap:80,compactGap:32,edgeGap:24,edgeLayerGap:28,compactEdgeGap:16,ink:'#0a3069',heading:'#0a3069',edge:'#0d6efd',accent:'#0d6efd',rectFill:'#eef5ff',rectStroke:'#0d6efd',diamondFill:'#fff4df',diamondStroke:'#d99a19',cylinderFill:'#e8f5f2',cylinderStroke:'#23856d',capFill:'#f2faf7',labelFill:'#f8fbff',labelStroke:'#c7daf5',labelInk:'#0a3069'},
    };
    const t = themes[opts.theme ?? 'default'];
    const size=(n:number)=>opts.theme==='ibm-inspired'?Math.ceil(n/8)*8:n;
    const nodeGap = opts.nodeGap ?? (opts.compact ? t.compactGap : t.nodeGap), layerGap = opts.layerGap ?? (opts.compact ? t.compactGap : t.layerGap);
    for (const [name, value] of [['nodeGap', nodeGap], ['layerGap', layerGap]] as const) if (!Number.isFinite(value) || value < 12 || value > 200) throw new Error(name + ' must be finite pixels from 12 to 200');
    if (!['right','down'].includes(direction)) throw new Error('direction must be right or down');
    if (!Array.isArray(opts.nodes) || opts.nodes.length > 100) throw new Error('nodes must be an array of at most 100 nodes');
    if (!Array.isArray(opts.edges) || opts.edges.length > 200) throw new Error('edges must be an array of at most 200 edges');
    const validText = (value: string, max: number, name: string) => {
        if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value) || !value.isWellFormed()) throw new Error(name + ' must be valid XML text, at most ' + max + ' characters');
    };
    if (opts.title !== undefined) validText(opts.title, 160, 'title');
    const ids = new Map<string, number>();
    for (const [i, n] of opts.nodes.entries()) {
        if (!n || typeof n.id !== 'string' || !n.id.trim() || n.id.length > 128 || ids.has(n.id)) throw new Error('Node IDs must be unique nonempty strings of at most 128 characters');
        validText(n.label, 300, 'node label');
        if (n.shape !== undefined && !['rect','diamond','cylinder'].includes(n.shape)) throw new Error('Unsupported node shape');
        ids.set(n.id, i);
    }
    const bundleTargets = new Map<string,string>();
    const degree = opts.nodes.map(() => 0), outgoing = opts.nodes.map(() => [] as number[]), pairs = new Set<string>();
    for (const e of opts.edges) {
        if (!e || !ids.has(e.from) || !ids.has(e.to)) throw new Error('Edge references an unknown node');
        if (e.bundle !== undefined) {
            if (typeof e.bundle !== 'string' || !e.bundle.trim() || e.bundle.length > 128) throw new Error('bundle must be nonblank and at most 128 characters');
            if (bundleTargets.has(e.bundle) && bundleTargets.get(e.bundle) !== e.to) throw new Error('bundle members must have the same target');
            bundleTargets.set(e.bundle,e.to);
        }
        if (e.label !== undefined) validText(e.label, 100, 'edge label');
        if (e.label?.includes('\n')) throw new Error('Edge labels must be single-line');
        const from = ids.get(e.from)!, to = ids.get(e.to)!, key = from + ':' + to;
        if (pairs.has(key)) throw new Error('Parallel edges are unsupported');
        pairs.add(key); outgoing[from]!.push(to); degree[to]!++;
    }
    const mainEdges = new Set<string>();
    if (opts.mainPath !== undefined) {
        if (!Array.isArray(opts.mainPath) || opts.mainPath.length < 2 || opts.mainPath.length > opts.nodes.length || new Set(opts.mainPath).size !== opts.mainPath.length || opts.mainPath.some(id => !ids.has(id))) throw new Error('mainPath must contain at least two unique existing node IDs');
        for (let i = 1; i < opts.mainPath.length; i++) {
            const key = ids.get(opts.mainPath[i-1]!) + ':' + ids.get(opts.mainPath[i]!);
            if (!pairs.has(key)) throw new Error('mainPath must follow existing directed edges');
            mainEdges.add(key);
        }
    }
    const ready = degree.flatMap((v,i) => v === 0 ? [i] : []);
    for (let i = 0; i < ready.length; i++) for (const to of outgoing[ready[i]!]!) if (--degree[to]! === 0) ready.push(to);
    if (ready.length !== opts.nodes.length) throw new Error('Only directed acyclic graphs are supported; remove cycles and self-loops');
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const measure = (text: string, size = t.font) => ctx.fns.svg.measureText({text,size,weight:500}).width * 1.08;
    const wrapped = opts.nodes.map(n => {
        const lines: string[] = [];
        for (const paragraph of n.label.split('\n')) {
            let line = '';
            for (const ch of paragraph) {
                if (line && measure(line + ch) > t.wrap) { lines.push(line.trimEnd()); line = ''; }
                line += ch;
            }
            lines.push(line.trimEnd());
        }
        return lines;
    });
    const sizes = opts.nodes.map((n,i) => {
        const lines = wrapped[i]!, tw = Math.max(0,...lines.map(s => measure(s))), th = lines.length * t.line;
        return {width: size(Math.ceil(n.shape === 'diamond' ? Math.max(t.diamondW, 2 * (tw + t.diamondX)) : Math.max(t.minW, tw + 2*t.padX))), height: size(n.shape === 'diamond' ? Math.max(t.diamondH,2 * (th + t.diamondY)) : Math.max(t.minH,th + 2*(n.shape === 'cylinder' ? t.cylinderPad:t.padY)))};
    });
    if (opts.columns) { const width = Math.max(...sizes.map(s => s.width)); for (const s of sizes) s.width = width; }
    const {resolve} = await import('node:path');
    const {default: ELK} = await import(resolve(import.meta.dir, '../../node_modules/elkjs/lib/main.js')) as typeof import('elkjs');
    const elk = new ELK({workerFactory: () => new Worker(resolve(import.meta.dir, '../../node_modules/elkjs/lib/elk-worker.min.js'))});
    const layout = await elk.layout<import("elkjs").ElkNode>({
        id:'root',
        layoutOptions: {'elk.algorithm':'layered','elk.direction':direction === 'right' ? 'RIGHT':'DOWN','elk.edgeRouting':'ORTHOGONAL','elk.padding':'[top=24,left=24,bottom=24,right=24]','elk.spacing.nodeNode':String(nodeGap),'elk.layered.spacing.nodeNodeBetweenLayers':String(layerGap),'elk.layered.spacing.edgeNodeBetweenLayers':String(opts.compact?t.compactEdgeGap:t.edgeLayerGap),'elk.spacing.edgeNode':String(opts.compact?t.compactEdgeGap:t.edgeGap),'elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES',...(opts.mainPath ? {'elk.layered.nodePlacement.strategy':'BRANDES_KOEPF','elk.layered.nodePlacement.bk.fixedAlignment':'LEFTUP','elk.layered.nodePlacement.favorStraightEdges':'true'} : {})},
        children:opts.nodes.map((n,i) => {
            const {width,height} = sizes[i]!;
            return {id:'n'+i,width,height,layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:[{id:'in'+i,x:direction === 'right'?0:width/2,y:direction === 'right'?height/2:0,width:0,height:0,layoutOptions:{'elk.port.side':direction === 'right'?'WEST':'NORTH'}},{id:'out'+i,x:direction === 'right'?width:width/2,y:direction === 'right'?height/2:height,width:0,height:0,layoutOptions:{'elk.port.side':direction === 'right'?'EAST':'SOUTH'}}]};
        }),
        edges:opts.edges.map((e,i) => ({id:'e'+i,sources:['out'+ids.get(e.from)],targets:['in'+ids.get(e.to)],...(opts.mainPath ? {layoutOptions:{'elk.layered.priority.straightness':mainEdges.has(ids.get(e.from)+':'+ids.get(e.to))?'100':'0'}} : {}),labels:e.label?[{id:'l'+i,text:e.label,width:Math.ceil(measure(e.label,t.labelFont)+2*t.labelX),height:t.labelLine+2*t.labelY,layoutOptions:{'elk.edgeLabels.placement':'CENTER'}}]:[]}))
    }).finally(() => elk.terminateWorker());
    if (opts.columns) {
        // Expand empty vertical strips, never node interiors. Apply the same monotone map
        // to every route and label: this preserves orthogonality and obstacle clearance.
        const children = layout.children ?? [], w = sizes[0]!.width;
        const axes = [...new Set(children.map(n => (n.x ?? 0) + w/2))].sort((a,b) => a-b);
        const main = children[ids.get(opts.mainPath![0]!)!]!, axis = (main.x ?? 0)+w/2;
        if (opts.mainPath!.some(id => Math.abs((children[ids.get(id)!]!.x ?? 0)+w/2-axis)>0.001)) throw new Error('columns requires ELK to produce a straight mainPath');
        const mid = axes.indexOf(axis), half = (opts.columns-1)/2;
        if (mid > half || axes.length-1-mid > half) throw new Error('columns has too few side lanes for this graph');
        if (axes.some((x,i) => i>0 && x-axes[i-1]! < w+1)) throw new Error('columns cannot align overlapping column projections');
        const bundleGap = bundleTargets.size ? Math.max(96,...opts.edges.filter(e=>e.bundle).map(e=>measure(e.label ?? '',t.labelFont)+2*t.labelX+64)) : 0;
        const pitch = Math.max(w+Math.max(nodeGap,bundleGap),...axes.slice(1).map((x,i)=>x-axes[i]!));
        const canvasWidth = Math.ceil(Math.max(240,opts.columns*w+(opts.columns-1)*(pitch-w)+80,opts.title ? measure(opts.title,20)+64:0));
        const target = axes.map((_,i)=>canvasWidth/2-16+(i-mid)*pitch);
        const mapX = (x:number) => {
            for (let i=0;i<axes.length;i++) {
                const left=axes[i]!-w/2, right=axes[i]!+w/2;
                if (x<=right) {
                    if (i===0 || x>=left) return x+target[i]!-axes[i]!;
                    const prev=axes[i-1]!+w/2, a=target[i-1]!+w/2, b=target[i]!-w/2;
                    return a+(x-prev)*(b-a)/(left-prev);
                }
            }
            return x+target.at(-1)!-axes.at(-1)!;
        };
        for (const n of children) n.x=mapX(n.x ?? 0);
        for (const e of layout.edges ?? []) {
            for (const s of e.sections ?? []) for (const p of [s.startPoint,...(s.bendPoints ?? []),s.endPoint]) p.x=mapX(p.x);
            for (const l of e.labels ?? []) l.x=mapX(l.x ?? 0);
        }
        layout.width=canvasWidth-32;
    }
    // Explicit shared geometry: member routes end at a junction, never repeat the trunk.
    type Point = {x:number;y:number};
    type Rect = {x:number;y:number;width:number;height:number};
    const bundles: Array<{id:string;to:string;points:Point[];junctions:Point[]}> = [];
    const memberRoutes = new Map<number,Point[]>();
    const transpose = (p:Point):Point => direction === 'down' ? {...p} : {x:p.y,y:p.x};
    const rect = (r:Rect):Rect => direction === 'down' ? {...r} : {x:r.y,y:r.x,width:r.height,height:r.width};
    const nodeRects = (layout.children ?? []).map(n=>rect({x:n.x!,y:n.y!,width:n.width!,height:n.height!}));
    const intersects = (a:Point,b:Point,r:Rect,pad=4) => Math.max(a.x,b.x)>r.x-pad && Math.min(a.x,b.x)<r.x+r.width+pad && Math.max(a.y,b.y)>r.y-pad && Math.min(a.y,b.y)<r.y+r.height+pad;
    const occupied:Rect[] = [];
    for (const [id,to] of bundleTargets) {
        const members=opts.edges.flatMap((e,i)=>e.bundle===id?[i]:[]), target=nodeRects[ids.get(to)!]!;
        const sources=members.map(i=>nodeRects[ids.get(opts.edges[i]!.from)!]!);
        const labels=(layout.edges ?? []).flatMap((e,i)=>opts.edges[i]!.bundle ? [] : (e.labels ?? []).map(l=>rect({x:l.x!,y:l.y!,width:l.width!,height:l.height!})));
        let chosen: {branches:Point[][];trunk:Point[];labels:Rect[]}|undefined;
        // Search both sides and every free strip boundary, not a graph-specific ID/label heuristic.
        const blockers=[...nodeRects,...labels,...occupied];
        const candidates=[...new Set(blockers.flatMap(r=>[r.x-24,r.x+r.width+24]).concat(sources.flatMap((r,j)=>[r.x-48-(layout.edges![members[j]!]!.labels?.[0]?.width ?? 0),r.x+r.width+48+(layout.edges![members[j]!]!.labels?.[0]?.width ?? 0)])))].filter(x=>x>=12);
        candidates.sort((a,b)=>sources.reduce((n,r)=>n+Math.abs(a-r.x-r.width/2),0)-sources.reduce((n,r)=>n+Math.abs(b-r.x-r.width/2),0));
        for (const x of candidates) {
            if(sources.some(r=>x>=r.x-8 && x<=r.x+r.width+8) || (x>=target.x-8 && x<=target.x+target.width+8)) continue;
            const ty=target.y+target.height/2, ys=sources.map(r=>r.y+r.height/2);
            if(ys.some(y=>y>=ty-8)) continue;
            const end={x:x<target.x?target.x:target.x+target.width,y:ty};
            const trunk=[{x,y:Math.min(...ys)},{x,y:ty},end];
            if(blockers.some(r=>intersects(trunk[0]!,trunk[1]!,r)) || blockers.some(r=>r!==target && intersects(trunk[1]!,end,r)))continue;
            const branches=sources.map((r,j)=>[{x:x<r.x?r.x:r.x+r.width,y:ys[j]!},{x,y:ys[j]!}]);
            if(branches.some((ps,j)=>blockers.some(r=>r!==sources[j] && intersects(ps[0]!,ps[1]!,r))))continue;
            const newLabels:Rect[]=[];let valid=true;
            for(const [j,i] of members.entries()) {
                const l=layout.edges![i]!.labels?.[0];if(!l)continue;
                const lr=rect({x:0,y:0,width:l.width!,height:l.height!}), ps=branches[j]!;
                lr.x=x>ps[0]!.x?ps[0]!.x+8:ps[0]!.x-8-lr.width;lr.y=ps[0]!.y-lr.height-8;
                if(lr.x<Math.min(ps[0]!.x,x)+4 || lr.x+lr.width>Math.max(ps[0]!.x,x)-4 || [...blockers,...newLabels].some(r=>lr.x<r.x+r.width+4 && lr.x+lr.width>r.x-4 && lr.y<r.y+r.height+4 && lr.y+lr.height>r.y-4)){valid=false;break;}
                newLabels.push(lr);
            }
            if(valid && newLabels.some(r=>[...branches,trunk].some(ps=>ps.slice(1).some((b,j)=>intersects(ps[j]!,b,r))))) valid=false;
            if(valid){chosen={branches,trunk,labels:newLabels};break;}
        }
        if(!chosen)throw new Error(`bundle "${id}": no clear side corridor; requires forward sources and unobstructed perpendicular joins (increase spacing or change layout)`);
        let labelIndex=0;
        for(const [j,i] of members.entries()) {
            memberRoutes.set(i,chosen.branches[j]!.map(transpose));
            const l=layout.edges![i]!.labels?.[0];if(l){const r=chosen.labels[labelIndex++]!,pos=transpose(r);l.x=pos.x;l.y=pos.y;}
        }
        const points=chosen.trunk.map(transpose), junctions=chosen.branches.map(ps=>transpose(ps[1]!));
        bundles.push({id,to,points,junctions});
        occupied.push(...chosen.labels);
        for(const ps of [...chosen.branches,chosen.trunk.map(p=>p)])for(let j=1;j<ps.length;j++){const a=ps[j-1]!,b=ps[j]!;occupied.push({x:Math.min(a.x,b.x)-2,y:Math.min(a.y,b.y)-2,width:Math.abs(a.x-b.x)+4,height:Math.abs(a.y-b.y)+4});}
        for(const p of points){layout.width=Math.max(layout.width ?? 0,p.x+24);layout.height=Math.max(layout.height ?? 0,p.y+24);}
    }
    const header = opts.title ? 64:18;
    const width = Math.ceil(Math.max(240, (layout.width ?? 0)+32, opts.title ? measure(opts.title,20)+64:0));
    const height = Math.ceil(Math.max(120,(layout.height ?? 0)+header+24));
    const prefix = 'flow-' + Bun.randomUUIDv7();
    const fragments = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${prefix}-title"><title id="${prefix}-title">${esc(opts.title ?? 'Flow diagram')}</title><defs><marker id="${prefix}-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="${t.arrow}" markerHeight="${t.arrow}" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="${t.edge}"/></marker></defs><rect width="${width}" height="${height}" fill="#fff"/><g font-family="Inter,Arial,Helvetica,sans-serif">`];
    fragments.push(`<rect x="32" y="20" width="28" height="3" rx="1.5" fill="${t.accent}"/>`);
    if(opts.title) fragments.push(`<text x="32" y="51" font-size="20" font-weight="600" fill="${t.heading}">${esc(opts.title)}</text>`);
    fragments.push(`<g transform="translate(16 ${header})">`);
    const routes: Array<{from:string;to:string;bundle?:string;points:Array<{x:number;y:number}>}> = [];
    for (const [i,e] of (layout.edges ?? []).entries()) {
        const member=memberRoutes.get(i);
        if(member){
            routes.push({from:opts.edges[i]!.from,to:opts.edges[i]!.to,bundle:opts.edges[i]!.bundle,points:member.map(p=>({x:p.x+16,y:p.y+header}))});
            fragments.push(`<path d="${member.map((p,j)=>(j?'L':'M')+' '+p.x+' '+p.y).join(' ')}" fill="none" stroke="${t.edge}" stroke-width="${t.connector}"/>`);
            continue;
        }
        const sections = e.sections ?? [];
        if (!sections.length) throw new Error('ELK returned an unrouted edge');
        const points = sections.flatMap(s => [s.startPoint,...(s.bendPoints ?? []),s.endPoint]);
        routes.push({from:opts.edges[i]!.from,to:opts.edges[i]!.to,points:points.map(p=>({x:p.x+16,y:p.y+header}))});
        for(const s of sections) {
            const ps = [s.startPoint,...(s.bendPoints ?? []),s.endPoint];
            fragments.push(`<path d="${ps.map((p,j)=>(j?'L':'M')+' '+p.x+' '+p.y).join(' ')}" fill="none" stroke="${t.edge}" stroke-width="${t.connector}" stroke-linejoin="round" marker-end="url(#${prefix}-arrow)"/>`);
        }
    }
    for(const b of bundles){
        fragments.push(`<path data-bundle="${esc(b.id)}" d="${b.points.map((p,j)=>(j?'L':'M')+' '+p.x+' '+p.y).join(' ')}" fill="none" stroke="${t.edge}" stroke-width="${t.connector}" stroke-linejoin="round" marker-end="url(#${prefix}-arrow)"/>`);
        for(const p of b.junctions)fragments.push(`<circle cx="${p.x}" cy="${p.y}" r="${t.connector+1}" fill="${t.edge}"/>`);
    }
    const boxes: Array<{id:string;x:number;y:number;width:number;height:number}> = [];
    for(const [i,n] of (layout.children ?? []).entries()) {
        const x=n.x!,y=n.y!,w=n.width!,h=n.height!, shape=opts.nodes[i]!.shape ?? 'rect';
        boxes.push({id:opts.nodes[i]!.id,x:x+16,y:y+header,width:w,height:h});
        const style = `fill="${shape === 'diamond' ? t.diamondFill : shape === 'cylinder' ? t.cylinderFill : t.rectFill}" stroke="${shape === 'diamond' ? t.diamondStroke : shape === 'cylinder' ? t.cylinderStroke : t.rectStroke}" stroke-width="${t.border}"`;
        if(shape==='diamond') fragments.push(`<path d="M ${x+w/2} ${y} L ${x+w} ${y+h/2} L ${x+w/2} ${y+h} L ${x} ${y+h/2} Z" ${style}/>`);
        else if(shape==='cylinder') fragments.push(`<path d="M ${x} ${y+12} C ${x} ${y-4} ${x+w} ${y-4} ${x+w} ${y+12} L ${x+w} ${y+h-12} C ${x+w} ${y+h+4} ${x} ${y+h+4} ${x} ${y+h-12} Z" ${style}/><ellipse cx="${x+w/2}" cy="${y+12}" rx="${w/2}" ry="12" fill="${t.capFill}" stroke="${t.cylinderStroke}" stroke-width="${t.border}"/>`);
        else fragments.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${t.radius}" ${style}/>`);
        const lines=wrapped[i]!;
        fragments.push(`<text text-anchor="middle" font-size="${t.font}" font-weight="500" fill="${t.ink}">${lines.map((line,j)=>`<tspan x="${x+w/2}" y="${y+h/2-(lines.length-1)*t.line/2+t.font*5/14+(shape==='cylinder'?5:0)}" dy="${j*t.line}">${esc(line)}</tspan>`).join('')}</text>`);
    }
    for(const e of layout.edges ?? []) for(const l of e.labels ?? []) fragments.push(`<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" rx="${t.labelRadius}" fill="${t.labelFill}" stroke="${t.labelStroke}"/><text x="${l.x!+l.width!/2}" y="${l.y!+t.labelY+t.labelLine/2+t.labelFont/3}" text-anchor="middle" font-size="${t.labelFont}" fill="${t.labelInk}">${esc(l.text ?? '')}</text>`);
    fragments.push('</g></g></svg>');
    return {svg:fragments.join(''),width,height,boxes,routes,bundles:bundles.map(b=>({...b,points:b.points.map(p=>({x:p.x+16,y:p.y+header})),junctions:b.junctions.map(p=>({x:p.x+16,y:p.y+header}))})),engine:'elk-layered' as const};
}
