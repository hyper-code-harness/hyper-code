/** Absolute top-left boxes for all flex nodes, including containers; no edges or SVG markup. */
export type FlexLayoutResult = {
    /** Boxes keyed by original ID; all coordinates are relative to the root origin. */
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    /** Input depth-first order, suitable for rendering containers behind their children. */
    order: string[];
    /** Union of all boxes, including any children overflowing their parents. */
    bounds: { x: number; y: number; width: number; height: number };
};
