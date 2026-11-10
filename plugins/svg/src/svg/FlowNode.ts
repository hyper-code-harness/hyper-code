/** Plain JSON flowchart node accepted by flowDiagram. Shape defaults to rect when omitted. */
export type FlowNode = {
    /** Unique nonblank node ID, at most 128 characters. */
    id: string;
    /** Visible label, at most 300 characters. */
    label: string;
    /** Process, decision or storage shape. @default rect */
    shape?: 'rect' | 'diamond' | 'cylinder';
};
