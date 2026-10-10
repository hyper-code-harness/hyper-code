/**
 * Validate a simple sized graph before layout.
 *
 * Rejects duplicate IDs, unknown endpoints, self-loops, parallel undirected edges and nonfinite geometry. Limits experimental workloads to 500 nodes and 2000 edges.
 * @param opts.nodes Unique nodes with positive sizes and optional initial top-left positions.
 * @param opts.edges Unique edges referencing existing node IDs.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique nodes with positive sizes and optional initial top-left positions. */
        nodes: Array<{id:string;w:number;h:number;x?:number;y?:number}>;
        /** Unique edges referencing existing node IDs. */
        edges: Array<{id:string;from:string;to:string}>;
    },
): Promise<void> {
    if(!Array.isArray(opts.nodes)||!Array.isArray(opts.edges))throw new Error('nodes and edges must be arrays');
    if(opts.nodes.length>500||opts.edges.length>2000)throw new Error('Layout limit: 500 nodes and 2000 edges');
    const ids=new Set<string>();
    for(const n of opts.nodes){if(!n||typeof n.id!=='string'||!n.id.trim()||ids.has(n.id))throw new Error('Node IDs must be unique nonempty strings');ids.add(n.id);if(!Number.isFinite(n.w)||!Number.isFinite(n.h)||n.w<=0||n.h<=0)throw new Error('Node sizes must be positive finite numbers');if((n.x!==undefined&&!Number.isFinite(n.x))||(n.y!==undefined&&!Number.isFinite(n.y)))throw new Error('Initial positions must be finite');}
    const edgeIds=new Set<string>(),pairs=new Set<string>();
    for(const e of opts.edges){if(!e||typeof e.id!=='string'||!e.id.trim()||edgeIds.has(e.id))throw new Error('Edge IDs must be unique nonempty strings');edgeIds.add(e.id);if(!ids.has(e.from)||!ids.has(e.to))throw new Error('Unknown edge endpoint');const key=JSON.stringify([e.from,e.to].sort());if(e.from===e.to||pairs.has(key))throw new Error('Self-loops and parallel edges are not supported');pairs.add(key);}
}
