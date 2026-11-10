/**
 * Create synchronous typed positional constructors for flowchart nodes and edges
 *
 * Await this factory once per flowchart in a trusted svg tsx fence, then use step, decision, database and link as ordinary functions. Node constructors share a factory-local counter generating node-1, node-2, etc.; the same construction order gives the same IDs. Optional { id } reserves a stable ID; duplicates throw and generated IDs skip reservations. Reuse fragment functions with the same factory without ID prefixes. Factories are independent, so merging their nodes may collide. Constructors return plain JSON and link copies node IDs; callers explicitly collect nodes and edges for flowDiagram. No mutable builder or automatic registration. flowDiagram remains authoritative for label limits, references and DAG-only validation: cycles, self-loops and parallel edges are unsupported. The factory result contains functions for in-process use, not HTTP JSON transport.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<types.svg.FlowConstructors> {
    let counter = 0;
    const reserved = new Set<string>();
    const allocate = (options?: { id: string }): string => {
        if (options !== undefined) {
            const id = options.id;
            if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Flow helper node ID must be nonblank and at most 128 characters');
            if (reserved.has(id)) throw new Error(`Duplicate flow helper node ID: ${id}`);
            reserved.add(id);
            return id;
        }
        let id: string;
        do { id = `node-${++counter}`; } while (reserved.has(id));
        reserved.add(id);
        return id;
    };
    return {
        step: (label, options) => ({ id: allocate(options), label, shape: 'rect' }),
        decision: (label, options) => ({ id: allocate(options), label, shape: 'diamond' }),
        database: (label, options) => ({ id: allocate(options), label, shape: 'cylinder' }),
        link: (from, to, label, options) => ({ from: from.id, to: to.id, ...(label === undefined ? {} : { label }), ...(options?.bundle === undefined ? {} : { bundle: options.bundle }) }),
    };
}
