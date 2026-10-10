import * as d3 from "d3-force";
const opts=JSON.parse(await Bun.stdin.text()) as {nodes:Array<{id:string;w:number;h:number;x?:number;y?:number}>,edges:Array<{id:string;from:string;to:string}>,seed:number,iterations:number,spacing:number};
const {seed,iterations,spacing}=opts;
    const nodes=opts.nodes.map(n=>({...n,x:n.x===undefined?undefined:n.x+n.w/2,y:n.y===undefined?undefined:n.y+n.h/2}));
    const links=opts.edges.map(e=>({source:e.from,target:e.to}));
    let state=seed>>>0;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
    const byId=new Map(nodes.map(n=>[n.id,n]));
    const sim=d3.forceSimulation(nodes).stop().randomSource(random)
    .force('charge',d3.forceManyBody().strength(-200))
    .force('center',d3.forceCenter(0,0))
    .force('collide',d3.forceCollide<(typeof nodes)[number]>().radius(n=>Math.hypot(n.w,n.h)/2+spacing/2).iterations(2))
    .force('link',d3.forceLink(links).id(n=>(n as (typeof nodes)[number]).id).distance(l=>{const a=typeof l.source==='object'?l.source:byId.get(String(l.source))!;const b=typeof l.target==='object'?l.target:byId.get(String(l.target))!;const aa=a as (typeof nodes)[number],bb=b as (typeof nodes)[number];return Math.hypot(aa.w,aa.h)/2+Math.hypot(bb.w,bb.h)/2+spacing;}));
    try{sim.tick(iterations);}finally{sim.stop();}
    const boxes=nodes.map(n=>({id:n.id,x:n.x!-n.w/2,y:n.y!-n.h/2,w:n.w,h:n.h}));
    const routes=opts.edges.map(e=>{const a=byId.get(e.from)!,b=byId.get(e.to)!;return {...e,points:[{x:a.x!,y:a.y!},{x:b.x!,y:b.y!}]};});

process.stdout.write(JSON.stringify({boxes,routes}));
