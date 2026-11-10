/** Synchronous positional constructors for flowDiagram JSON. Each factory shares one deterministic node-ID counter. Explicit IDs reserve names; generated IDs skip reservations. No automatic registration or layout occurs. Use one factory across reusable fragment functions; independent factories may produce colliding IDs. flowDiagram validates labels, references and the DAG-only graph (no cycles, self-loops or parallel edges). */
export type FlowConstructors = {
    /** Process rectangle. Optional options.id reserves a stable ID instead of generating node-N. */
    step(label: string, options?: { id: string }): types.svg.FlowNode & { shape: 'rect' };
    /** Decision diamond. Optional options.id reserves a stable ID instead of generating node-N. */
    decision(label: string, options?: { id: string }): types.svg.FlowNode & { shape: 'diamond' };
    /** Storage cylinder. Optional options.id reserves a stable ID instead of generating node-N. */
    database(label: string, options?: { id: string }): types.svg.FlowNode & { shape: 'cylinder' };
    /** Copy typed node handles to source/target ID strings; omit label when not supplied. Optional options.bundle explicitly groups links to one target. */
    link(from: types.svg.FlowNode, to: types.svg.FlowNode, label?: string, options?: { bundle?: string }): types.svg.FlowEdge;
};
