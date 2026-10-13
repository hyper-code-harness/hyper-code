/**
 * Builds a module dependency graph from Hyper's indexed function calls
 *
 * Use this read-only function to explore module coupling, weighted dependencies, entry points, and strongly connected module groups before architecture work or while rendering an interactive Canvas map.
 * @param opts.includeTests Include call edges originating from tests. @default false
 * @param opts.minWeight Minimum number of call sites required to retain a module dependency. @default 1 @minimum 1 @maximum 10000
 * @param opts.limit Maximum number of highest-function-count modules returned. @default 120 @minimum 2 @maximum 500
 * @param opts.root Restrict function nodes to one indexed source root, such as core or a plugin name.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Include call edges originating from tests. @default false */
        includeTests?: boolean;
        /** Minimum number of call sites required to retain a module dependency. @default 1 @minimum 1 @maximum 10000 */
        minWeight?: number;
        /** Maximum number of highest-function-count modules returned. @default 120 @minimum 2 @maximum 500 */
        limit?: number;
        /** Restrict function nodes to one indexed source root, such as core or a plugin name. */
        root?: string;
    },
): Promise<{ generatedAt: number; filters: { includeTests: boolean; minWeight: number; limit: number; root: string | null }; totals: { indexedFunctions: number; modules: number; dependencies: number; cycles: number }; nodes: Array<{ id: string; functions: number; incoming: number; outgoing: number; entryPoints: number; roots: string[]; instability: number | null }>; edges: Array<{ source: string; target: string; weight: number; kinds: string[]; samples: Array<{ rel: string; line: number }> }>; cycles: string[][] }> {
    const includeTests = opts.includeTests ?? false;
    const minWeight = opts.minWeight ?? 1;
    const limit = opts.limit ?? 120;
    const root = opts.root?.trim() || null;
    const functions = await ctx.fns.procs.db.select({ sql: `select name, root, rel, entry_point, tier from code_functions where (?::text is null or root = ?) order by name`, params: [root, root] });
    const calls = await ctx.fns.procs.db.select({ sql: `select caller, callee, rel, line, kind from code_calls where (?::boolean or kind <> 'test') and not discarded`, params: [includeTests] });
    const moduleOf = (name: string, rel?: string) => { const clean = name.replace(/^types\./, ''); const dot = clean.indexOf('.'); if (dot > 0) return clean.slice(0, dot); const slash = clean.indexOf('/'); if (slash > 0) return clean.slice(0, slash); const relSlash = rel?.indexOf('/') ?? -1; return relSlash > 0 ? rel!.slice(0, relSlash) : clean; };
    const nodeMap = new Map<string, { id: string; functions: number; incoming: number; outgoing: number; entryPoints: number; roots: Set<string> }>();
    for (const fn of functions as Array<{ name: string; root: string; rel: string; entry_point: boolean }>) { const id = moduleOf(fn.name, fn.rel); const node = nodeMap.get(id) ?? { id, functions: 0, incoming: 0, outgoing: 0, entryPoints: 0, roots: new Set<string>() }; node.functions += 1; if (fn.entry_point) node.entryPoints += 1; node.roots.add(fn.root); nodeMap.set(id, node); }
    const edgeMap = new Map<string, { source: string; target: string; weight: number; kinds: Set<string>; samples: Array<{ rel: string; line: number }> }>();
    for (const call of calls as Array<{ caller: string; callee: string; rel: string; line: number; kind: string }>) { const source = moduleOf(call.caller, call.rel); const target = moduleOf(call.callee); if (!source || !target || source === target || !nodeMap.has(source) || !nodeMap.has(target)) continue; const key = source + '→' + target; const edge = edgeMap.get(key) ?? { source, target, weight: 0, kinds: new Set<string>(), samples: [] }; edge.weight += 1; edge.kinds.add(call.kind); if (edge.samples.length < 5) edge.samples.push({ rel: call.rel, line: call.line }); edgeMap.set(key, edge); }
    let edges = [...edgeMap.values()].filter(edge => edge.weight >= minWeight).sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));
    const connected = new Set(edges.flatMap(edge => [edge.source, edge.target])); let nodes = [...nodeMap.values()].filter(node => connected.has(node.id)).sort((a, b) => b.functions - a.functions || a.id.localeCompare(b.id));
    if (nodes.length > limit) { const keep = new Set(nodes.slice(0, limit).map(node => node.id)); nodes = nodes.filter(node => keep.has(node.id)); edges = edges.filter(edge => keep.has(edge.source) && keep.has(edge.target)); }
    for (const edge of edges) { const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target); if (source) source.outgoing += 1; if (target) target.incoming += 1; }
    const adjacency = new Map(nodes.map(node => [node.id, edges.filter(edge => edge.source === node.id).map(edge => edge.target)])); let index = 0; const stack: string[] = []; const onStack = new Set<string>(); const indices = new Map<string, number>(); const low = new Map<string, number>(); const cycles: string[][] = [];
    const visit = (id: string) => { indices.set(id, index); low.set(id, index); index += 1; stack.push(id); onStack.add(id); for (const next of adjacency.get(id) ?? []) { if (!indices.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); } else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, indices.get(next)!)); } if (low.get(id) === indices.get(id)) { const group: string[] = []; let next = ''; do { next = stack.pop()!; onStack.delete(next); group.push(next); } while (next !== id); if (group.length > 1) cycles.push(group.sort()); } };
    for (const node of nodes) if (!indices.has(node.id)) visit(node.id);
    return { generatedAt: Date.now(), filters: { includeTests, minWeight, limit, root }, totals: { indexedFunctions: functions.length, modules: nodes.length, dependencies: edges.length, cycles: cycles.length }, nodes: nodes.map(node => ({ ...node, roots: [...node.roots].sort(), instability: node.incoming + node.outgoing === 0 ? null : node.outgoing / (node.incoming + node.outgoing) })), edges: edges.map(edge => ({ ...edge, kinds: [...edge.kinds].sort() })), cycles: cycles.sort((a, b) => b.length - a.length) };
}
