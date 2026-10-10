/**
 * Compresses existing graph boxes with radial attraction and independent inward relaxation
 *
 * Use after ACA layoutIncremental. A deterministic 160-step anisotropic attraction toward the original center or focus uses 16 collision/order projection sweeps per step. Fixed ACA separation axes and center-order constraints protect branches. Stronger long-axis pressure softly favors a square. After coarse-grid snapping, each box independently approaches the focus within the same constraints until no inward move remains (at most twice the box count in sweeps). A blocked box does not stop other branches. This prioritizes removing radial slack over a square bounding box; long aligned chains can remain wide. Never shelf-packs. Sizes and identities are unchanged. Recomputes border-clipped straight routes, which may cross boxes. Origin is reset to zero; old route geometry and metadata are discarded.
 * @param opts.layout Materialized geometry with at most 60 uniquely identified boxes and 300 routes. Coordinates within +/-1e9; positive dimensions at most 1000000. Route endpoints must exist; self-loops are unsupported. Old route geometry is discarded.
 * @param opts.focusId Optional attraction anchor box ID, for example Pod; defaults to the original bounding-box center.
 * @param opts.gridSize Integer grid spacing for every box top-left; box dimensions stay unchanged. @default 50 @minimum 1 @maximum 1000000
 * @param opts.gap Minimum axis separation between rectangles, enforced before and after constrained snapping. @default 32 @minimum 0 @maximum 1000000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Materialized geometry with at most 60 uniquely identified boxes and 300 routes. Coordinates within +/-1e9; positive dimensions at most 1000000. Route endpoints must exist; self-loops are unsupported. Old route geometry is discarded. */
        layout: types.svg.GraphLayoutResult;
        /** Integer grid spacing for every box top-left; box dimensions stay unchanged. @default 50 @minimum 1 @maximum 1000000 */
        gridSize?: number;
        /** Minimum axis separation between rectangles, enforced before and after constrained snapping. @default 32 @minimum 0 @maximum 1000000 */
        gap?: number;
        /** Optional attraction anchor box ID; defaults to the original bounding-box center. */
        focusId?: string;
    },
): Promise<types.svg.GraphLayoutResult> {
    const gridSize = opts.gridSize ?? 50, gap = opts.gap ?? 32;
    if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 1e6) throw new Error('gridSize must be an integer between 1 and 1000000');
    if (!Number.isFinite(gap) || gap < 0 || gap > 1e6) throw new Error('gap must be finite between 0 and 1000000');
    const { boxes: input, routes: edges } = opts.layout;
    if (!Array.isArray(input) || input.length > 60 || !Array.isArray(edges) || edges.length > 300) throw new Error('layout requires at most 60 boxes and 300 routes');
    type Box = types.svg.GraphLayoutResult['boxes'][number];
    const byId = new Map<string, Box>();
    for (const b of input) {
        if (!b || typeof b.id !== 'string' || !b.id.trim() || byId.has(b.id)) throw new Error('Box IDs must be unique nonempty strings');
        if (![b.x,b.y,b.w,b.h].every(Number.isFinite) || Math.abs(b.x)>1e9 || Math.abs(b.y)>1e9 || b.w<=0 || b.h<=0 || b.w>1e6 || b.h>1e6) throw new Error('Boxes require finite coordinates within +/-1e9 and positive sizes up to 1000000');
        byId.set(b.id,b);
    }
    const edgeIds = new Set<string>();
    for (const e of edges) {
        if (!e || typeof e.id !== 'string' || !e.id.trim() || edgeIds.has(e.id)) throw new Error('Route IDs must be unique nonempty strings');
        if (!byId.has(e.from) || !byId.has(e.to)) throw new Error('Route endpoint is missing');
        if (e.from===e.to) throw new Error('Self-loops are unsupported');
        edgeIds.add(e.id);
    }
    const metadata: types.svg.GraphLayoutResult['metadata'] = {
        algorithm: 'radial-compaction', engine: 'constrained-anisotropic-projection', routing: 'straight',
        warnings: ['Bounded radial heuristic preserves center order and separation axes, not topology or optimality; a square or smaller area is not guaranteed.', 'Routes were recomputed and border-clipped; straight segments may cross boxes or other edges.']
    };
    if (opts.focusId !== undefined && !byId.has(opts.focusId)) throw new Error('focusId must identify an existing box');
    if (!input.length) return { boxes: [], routes: [], bounds: {x:0,y:0,width:0,height:0}, metadata };
    const original=input.map(b=>({x:b.x+b.w/2,y:b.y+b.h/2}));
    const minX=Math.min(...input.map(b=>b.x)), minY=Math.min(...input.map(b=>b.y));
    const oldW=Math.max(...input.map(b=>b.x+b.w))-minX, oldH=Math.max(...input.map(b=>b.y+b.h))-minY;
    const focusIndex=input.findIndex(b=>b.id===opts.focusId);
    const focus=focusIndex<0?{x:minX+oldW/2,y:minY+oldH/2}:original[focusIndex]!;
    type Constraint = {a:number;b:number;d:number};
    const constraints:{x:Constraint[];y:Constraint[]}={x:[],y:[]};
    // Freeze the separating direction from ACA; never invent shelves or exchange branches.
    for(let i=0;i<input.length;i++) for(let j=i+1;j<input.length;j++) {
        const a=input[i]!,b=input[j]!,dx=original[j]!.x-original[i]!.x,dy=original[j]!.y-original[i]!.y;
        const sx=(a.w+b.w)/2+gap,sy=(a.h+b.h)/2+gap;
        const axis=Math.abs(dx)/sx>=Math.abs(dy)/sy?'x':'y';
        for(const k of ['x','y'] as const) {
            const forward=original[j]![k]>=original[i]![k];
            constraints[k].push({a:forward?i:j,b:forward?j:i,d:axis===k?(k==='x'?sx:sy):0});
        }
    }
    const points=original.map(p=>({...p}));
    // Long-axis pressure rises smoothly with aspect. Original radial targets penalize displacement.
    const ratio=Math.max(oldW,oldH)/Math.min(oldW,oldH);
    const shortScale=0.80, longScale=Math.max(0.18,shortScale/Math.pow(ratio,0.8));
    const scale={x:oldW>=oldH?longScale:shortScale,y:oldH>=oldW?longScale:shortScale};
    for(let iteration=0;iteration<160;iteration++) {
        const progress=(iteration+1)/160;
        for(let i=0;i<points.length;i++) for(const k of ['x','y'] as const) {
            const target=focus[k]+(original[i]![k]-focus[k])*(1-progress*(1-scale[k]));
            points[i]![k]+=0.22*(target-points[i]![k]);
        }
        for(let sweep=0;sweep<16;sweep++) for(const k of ['x','y'] as const) for(const c of constraints[k]) {
            const deficit=c.d-(points[c.b]![k]-points[c.a]![k]);
            if(deficit>0) {
                const wa=c.a===focusIndex?0: c.b===focusIndex?1:0.5;
                points[c.a]![k]-=deficit*wa;points[c.b]![k]+=deficit*(1-wa);
            }
        }
    }
    // Nearest coarse lattice targets, constrained by the SAME ACA order/separation DAG.
    // Forward feasibility followed by bounded coordinate relaxation, never row repacking.
    const boxes=input.map((b,i)=>({...b,x:Math.round((points[i]!.x-b.w/2)/gridSize)*gridSize,y:Math.round((points[i]!.y-b.h/2)/gridSize)*gridSize}));
    for(const k of ['x','y'] as const) {
        const size=k==='x'?'w':'h';
        const order=input.map((_,i)=>i).sort((a,b)=>original[a]![k]-original[b]![k] || a-b);
        const incoming=input.map(()=>[] as Constraint[]),outgoing=input.map(()=>[] as Constraint[]);
        for(const c of constraints[k]) {
            const q={...c,d:Math.ceil((c.d+(input[c.a]![size]-input[c.b]![size])/2)/gridSize)*gridSize};
            incoming[q.b]!.push(q);outgoing[q.a]!.push(q);
        }
        const target=boxes.map(b=>b[k]);
        for(const i of order) for(const c of incoming[i]!) boxes[i]![k]=Math.max(boxes[i]![k],boxes[c.a]![k]+c.d);
        for(let sweep=0;sweep<8;sweep++) for(const i of sweep%2?[...order].reverse():order) {
            const lower=Math.max(-Infinity,...incoming[i]!.map(c=>boxes[c.a]![k]+c.d));
            const upper=Math.min(Infinity,...outgoing[i]!.map(c=>boxes[c.b]![k]-c.d));
            boxes[i]![k]=Math.min(upper,Math.max(lower,target[i]!));
        }
    }
    // Independent inward relaxation removes slack left by the soft radial targets.
    // Keep every original separation/order constraint: no branch exchange or shelf packing.
    // Direct interval moves (not grid-sized steps) also handle very large coordinates.
    for(const k of ['x','y'] as const) {
        const size=k==='x'?'w':'h';
        const anchor=focusIndex<0?focus[k]:boxes[focusIndex]![k]+input[focusIndex]![size]/2;
        const incoming=input.map(()=>[] as Constraint[]),outgoing=input.map(()=>[] as Constraint[]);
        for(const c of constraints[k]) {
            const q={...c,d:Math.ceil((c.d+(input[c.a]![size]-input[c.b]![size])/2)/gridSize)*gridSize};
            incoming[q.b]!.push(q);outgoing[q.a]!.push(q);
        }
        for(let sweep=0;sweep<input.length*2;sweep++) {
            let moved=false;
            const order=input.map((_,i)=>i).sort((a,b)=>Math.abs(boxes[a]![k]+input[a]![size]/2-anchor)-Math.abs(boxes[b]![k]+input[b]![size]/2-anchor)||a-b);
            for(const i of order) {
                if(i===focusIndex) continue;
                const lower=Math.max(-Infinity,...incoming[i]!.map(c=>boxes[c.a]![k]+c.d));
                const upper=Math.min(Infinity,...outgoing[i]!.map(c=>boxes[c.b]![k]-c.d));
                const centerTarget=anchor-input[i]![size]/2;
                const side=Math.sign(original[i]![k]-focus[k]);
                const target=side<0?(Math.ceil(centerTarget/gridSize)-1)*gridSize:side>0?(Math.floor(centerTarget/gridSize)+1)*gridSize:Math.round(centerTarget/gridSize)*gridSize;
                const candidate=Math.min(upper,Math.max(lower,target));
                // Only inward moves; retain grid membership even with fractional box dimensions.
                const next=Math.abs(candidate-centerTarget)<Math.abs(boxes[i]![k]-centerTarget)?candidate:boxes[i]![k];
                if(next!==boxes[i]![k]) {boxes[i]![k]=next;moved=true;}
            }
            if(!moved) break; // Global completion only after examining EVERY box.
        }
    }
    // Translation only: origin normalization cannot change directions, gaps or grid membership.
    const offsetX=Math.min(...boxes.map(b=>b.x)),offsetY=Math.min(...boxes.map(b=>b.y));
    for(const b of boxes) {b.x-=offsetX;b.y-=offsetY;}
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
        const a=boxes[i]!,b=boxes[j]!;
        if(!(a.x+a.w+gap<=b.x || b.x+b.w+gap<=a.x || a.y+a.h+gap<=b.y || b.y+b.h+gap<=a.y)) throw new Error('Compaction failed gap validation');
    }
    const placed=new Map(boxes.map(b=>[b.id,b]));
    const routes=edges.map(e=>{
        const a=placed.get(e.from)!,b=placed.get(e.to)!;
        const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2,dx=bx-ax,dy=by-ay;
        const ta=Math.min(dx===0?Infinity:a.w/2/Math.abs(dx),dy===0?Infinity:a.h/2/Math.abs(dy));
        const tb=Math.min(dx===0?Infinity:b.w/2/Math.abs(dx),dy===0?Infinity:b.h/2/Math.abs(dy));
        return {id:e.id,from:e.from,to:e.to,points:[{x:ax+dx*ta,y:ay+dy*ta},{x:bx-dx*tb,y:by-dy*tb}]};
    });
    return {boxes,routes,bounds:{x:0,y:0,width:Math.max(...boxes.map(b=>b.x+b.w)),height:Math.max(...boxes.map(b=>b.y+b.h))},metadata};
}
