/**
 * Lay out sized graph nodes with seeded d3-force and straight edge segments.
 *
 * Experimental force-directed layout using d3-force 3.0.0 (ISC). Fixed ticks and a seeded random source provide repeatability for identical input order and options. Circular collision envelopes conservatively cover rectangles; no orthogonal routing, overlap-free or crossing-free guarantee. Initial x/y are top-left positions. Compute once outside SVG render and store geometry.
 * @param opts.nodes Sized nodes with optional initial top-left positions; simple graphs up to 500 nodes.
 * @param opts.edges Unique edges with existing endpoints, no loops or parallel edges.
 * @param opts.seed Unsigned 32-bit seed for the d3 simulation random source. @default 1 @minimum 0 @maximum 4294967295
 * @param opts.iterations Fixed simulation ticks, trading runtime for convergence. @default 300 @minimum 1 @maximum 2000
 * @param opts.spacing Additional collision-envelope and link-distance clearance in pixels. @default 24 @minimum 0 @maximum 1000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Sized nodes with optional initial top-left positions; simple graphs up to 500 nodes. */
        nodes: Array<{id:string;w:number;h:number;x?:number;y?:number}>;
        /** Unique edges with existing endpoints, no loops or parallel edges. */
        edges: Array<{id:string;from:string;to:string}>;
        /** Unsigned 32-bit seed for the d3 simulation random source. @default 1 @minimum 0 @maximum 4294967295 */
        seed?: number;
        /** Fixed simulation ticks, trading runtime for convergence. @default 300 @minimum 1 @maximum 2000 */
        iterations?: number;
        /** Additional collision-envelope and link-distance clearance in pixels. @default 24 @minimum 0 @maximum 1000 */
        spacing?: number;
    },
): Promise<types.svg.GraphLayoutResult> {
    await ctx.fns.svg.layoutValidate({nodes:opts.nodes,edges:opts.edges});
    const seed=opts.seed??1,iterations=opts.iterations??300,spacing=opts.spacing??24;
    if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('seed must be an unsigned 32-bit integer');
    if(!Number.isInteger(iterations)||iterations<1||iterations>2000)throw new Error('iterations must be an integer from 1 to 2000');
    if(!Number.isFinite(spacing)||spacing<0||spacing>1000)throw new Error('spacing must be from 0 to 1000');
    const metadata:types.svg.GraphLayoutResult['metadata']={algorithm:'force-directed',engine:'d3-force@3.0.0',routing:'straight',warnings:['Straight center-to-center edges; no obstacle routing.','Circular collision envelopes; no guaranteed overlap or crossing elimination.']};
    if(!opts.nodes.length)return await ctx.fns.svg.layoutResult({boxes:[],routes:[],metadata});
    const { resolve } = await import('node:path');
    const script=resolve(import.meta.dir,'../../scripts/force_layout.ts');
    const child=Bun.spawn([process.execPath,script],{stdin:new TextEncoder().encode(JSON.stringify({...opts,seed,iterations,spacing})),stdout:'pipe',stderr:'pipe'});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},30000);
    let output:string;
    try{const [code,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);if(timedOut)throw new Error('Force layout timed out after 30000 ms');if(code!==0)throw new Error('Force engine failed: '+stderr.slice(0,2000));output=stdout;}finally{clearTimeout(timer);}
    const result=JSON.parse(output) as Pick<types.svg.GraphLayoutResult,'boxes'|'routes'>;
    return await ctx.fns.svg.layoutResult({...result,metadata});
}
