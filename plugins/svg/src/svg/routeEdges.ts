/**
 * Routes orthogonal SVG paths around fixed rectangular obstacles without dependencies.
 *
 * Use for small hand-positioned diagrams. Finds rectilinear paths between side-midpoint ports while avoiding every box with clearance. Returns points and SVG path data, not arrowheads. Paths minimize Manhattan length plus bend costs. gridSize snaps side ports along box borders and adds outward-rounded obstacle lanes; exact boundaries remain for narrow passages. Short legs remain possible near endpoints. Box positions are never changed. Edges are routed independently: crossings and shared segments are possible. Labels and self-links are unsupported. Throws on invalid input, overlapping clearance regions or missing routes.
 * @param opts.boxes Up to 60 rectangles with unique nonempty IDs, finite coordinates and positive sizes.
 * @param opts.edges Connections with unique IDs and distinct source and target box IDs.
 * @param opts.gap Obstacle clearance in SVG coordinate units. @default 12 @minimum 1
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Up to 60 rectangles with unique nonempty IDs, finite coordinates and positive sizes. */
        boxes: { id: string; x: number; y: number; w: number; h: number }[];
        /** Connections with unique IDs and distinct source and target box IDs. */
        edges: { id: string; from: string; to: string }[];
        /** Obstacle clearance in SVG coordinate units. @default 12 @minimum 1 */
        gap?: number;
        /** Preferred coordinate grid for ports and obstacle lanes; zero disables snapping. @default 16 @minimum 0 */
        gridSize?: number;
        /** Added path cost for each right-angle turn. @default 32 @minimum 0 */
        bendPenalty?: number;
    },
): Promise<{ id: string; points: { x: number; y: number }[]; d: string }[]> {
    const {boxes,edges}=opts, gap=opts.gap??12;
    const gridSize=opts.gridSize??16, bendPenalty=opts.bendPenalty??32;
    if(!Number.isFinite(gridSize)||gridSize<0||!Number.isFinite(bendPenalty)||bendPenalty<0)throw new Error('Invalid gridSize or bendPenalty');
    const snap=(v:number,lo:number,hi:number)=>gridSize?Math.max(lo,Math.min(hi,Math.round(v/gridSize)*gridSize)):v;
    type P={x:number;y:number};
    if(!Number.isFinite(gap)||gap<1||boxes.length>60)throw new Error('Invalid gap or more than 60 boxes');
    const byId=new Map(boxes.map(b=>[b.id,b]));
    if(byId.size!==boxes.length)throw new Error('Duplicate box IDs');
    for(const b of boxes)if(!b.id||![b.x,b.y,b.w,b.h,b.x+b.w+gap,b.y+b.h+gap].every(Number.isFinite)||b.w<=0||b.h<=0)throw new Error('Invalid box '+b.id);
    const obstacles=boxes.map(b=>({id:b.id,l:b.x-gap,r:b.x+b.w+gap,t:b.y-gap,b:b.y+b.h+gap}));
    for(const a of obstacles)for(const b of obstacles)if(a.id<b.id&&a.l<b.r&&a.r>b.l&&a.t<b.b&&a.b>b.t)throw new Error('Overlapping clearance: '+a.id+', '+b.id);
    const ports=(b:typeof boxes[number],g:number):P[]=>{
      const cx=snap(b.x+b.w/2,b.x+b.w*.2,b.x+b.w*.8),cy=snap(b.y+b.h/2,b.y+b.h*.2,b.y+b.h*.8);
      return [{x:b.x-g,y:cy},{x:b.x+b.w+g,y:cy},{x:cx,y:b.y-g},{x:cx,y:b.y+b.h+g}];
    };
    const xs=[...new Set([...obstacles.flatMap(b=>[b.l,b.r]),...boxes.flatMap(b=>ports(b,gap).map(p=>p.x))])].sort((a,b)=>a-b);
    const ys=[...new Set([...obstacles.flatMap(b=>[b.t,b.b]),...boxes.flatMap(b=>ports(b,gap).map(p=>p.y))])].sort((a,b)=>a-b);
    if(gridSize){
      for(const b of obstacles){xs.push(Math.floor(b.l/gridSize)*gridSize,Math.ceil(b.r/gridSize)*gridSize);ys.push(Math.floor(b.t/gridSize)*gridSize,Math.ceil(b.b/gridSize)*gridSize);}
      xs.splice(0,xs.length,...[...new Set(xs)].sort((a,b)=>a-b));ys.splice(0,ys.length,...[...new Set(ys)].sort((a,b)=>a-b));
    }
    const key=(p:P)=>p.x+','+p.y;
    const clear=(a:P,b:P)=>!obstacles.some(r=>a.y===b.y ? a.y>r.t&&a.y<r.b&&Math.max(a.x,b.x)>r.l&&Math.min(a.x,b.x)<r.r : a.x>r.l&&a.x<r.r&&Math.max(a.y,b.y)>r.t&&Math.min(a.y,b.y)<r.b);
    const nodes=new Map<string,{p:P;neighbors:string[]}>();
    for(const x of xs)for(const y of ys)if(!obstacles.some(r=>x>r.l&&x<r.r&&y>r.t&&y<r.b))nodes.set(key({x,y}),{p:{x,y},neighbors:[]});
    for(const [k,n] of nodes){const xi=xs.indexOf(n.p.x),yi=ys.indexOf(n.p.y);for(const p of [{x:xs[xi+1],y:n.p.y},{x:n.p.x,y:ys[yi+1]}])if(p.x!==undefined&&p.y!==undefined){const q={x:p.x,y:p.y},other=nodes.get(key(q));if(other&&clear(n.p,q)){n.neighbors.push(key(q));other.neighbors.push(k);}}}
    const ids=new Set<string>();
    return edges.map(e=>{
     if(!e.id||ids.has(e.id))throw new Error('Invalid edge ID');ids.add(e.id);
     const source=byId.get(e.from),target=byId.get(e.to);
     if(!source||!target||source===target)throw new Error('Unknown endpoint or self-link: '+e.id);
     const starts=ports(source,gap),ends=ports(target,gap),targets=new Set(ends.map(key));
     const previous=new Map<string,string|null>(),dist=new Map<string,number>();
     const heap:Array<{state:string;cost:number}>=[];
     const push=(item:{state:string;cost:number})=>{heap.push(item);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]!.cost<=item.cost)break;heap[i]=heap[p]!;i=p;}heap[i]=item;};
     const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1]!.cost<heap[c]!.cost)c++;if(heap[c]!.cost>=last.cost)break;heap[i]=heap[c]!;i=c;}heap[i]=last;}return first;};
     starts.forEach((p,i)=>{const state=key(p)+'|'+(i<2?'h':'v');previous.set(state,null);dist.set(state,0);push({state,cost:0});});
     let found:string|undefined;
     while(heap.length){const {state,cost}=pop();if(cost!==dist.get(state))continue;const [k,dir]=state.split('|');
       if(targets.has(k!)){found=state;break;}
       const a=nodes.get(k!)!;
       for(const next of a.neighbors){const b=nodes.get(next)!,nd=a.p.y===b.p.y?'h':'v',ns=next+'|'+nd;
         const length=Math.abs(a.p.x-b.p.x)+Math.abs(a.p.y-b.p.y);
         const nc=cost+length+(nd!==dir?bendPenalty:0);
         if(nc<(dist.get(ns)??Infinity)){dist.set(ns,nc);previous.set(ns,state);push({state:ns,cost:nc});}
       }
     }
     if(found===undefined)throw new Error('No route for '+e.id);
     const path:P[]=[];let k:string|null=found;
     while(k!==null){path.push(nodes.get(k.split('|')[0]!)!.p);k=previous.get(k)??null;}path.reverse();
     const startIndex=starts.findIndex(p=>key(p)===key(path[0]!)),endIndex=ends.findIndex(p=>key(p)===found!.split('|')[0]);
     const raw=[ports(source,0)[startIndex]!,...path,ports(target,0)[endIndex]!],points:P[]=[];
     for(const p of raw){const last=points.at(-1);if(last&&key(last)===key(p))continue;while(points.length>=2){const a=points.at(-2)!,b=points.at(-1)!;if((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y))points.pop();else break;}points.push(p);}
     return {id:e.id,points,d:points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ')};
    });
}
