/**
 * Validate materialized layout geometry and compute bounds including routes.
 *
 * Shared finalizer for experimental layouts. Rejects nonfinite geometry. Empty layouts have zero bounds.
 * @param opts.boxes Positioned boxes using top-left coordinates.
 * @param opts.routes Edge polylines retaining original IDs.
 * @param opts.metadata Real algorithm, engine, routing and limitations.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Positioned boxes using top-left coordinates. */
        boxes: types.svg.GraphLayoutResult["boxes"];
        /** Edge polylines retaining original IDs. */
        routes: types.svg.GraphLayoutResult["routes"];
        /** Real algorithm, engine, routing and limitations. */
        metadata: types.svg.GraphLayoutResult["metadata"];
    },
): Promise<types.svg.GraphLayoutResult> {
    const points:Array<{x:number;y:number}>=[];
    for(const b of opts.boxes){if(![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0)throw new Error('Layout produced invalid box geometry');points.push({x:b.x,y:b.y},{x:b.x+b.w,y:b.y+b.h});}
    for(const r of opts.routes){if(r.points.length<2)throw new Error('Layout produced an empty route');for(const p of r.points){if(!Number.isFinite(p.x)||!Number.isFinite(p.y))throw new Error('Layout produced nonfinite route');points.push(p);}}
    let x=0,y=0,right=0,bottom=0;
    if(points.length){x=right=points[0]!.x;y=bottom=points[0]!.y;for(const p of points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}}
    return {...opts,bounds:{x,y,width:right-x,height:bottom-y}};
}
