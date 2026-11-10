/** Plain JSON directed edge accepted by flowDiagram; endpoints reference node IDs. */
export type FlowEdge = {
    /** Source node ID. */
    from: string;
    /** Target node ID. */
    to: string;
    /** Optional single-line visible label, at most 100 characters. */
    label?: string;
    /** Explicit shared side-trunk group; all members must have the same target. */
    bundle?: string;
};
