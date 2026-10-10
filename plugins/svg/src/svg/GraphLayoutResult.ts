/** Materialized graph geometry. Coordinates use top-left boxes; routes preserve input edge IDs. */
export type GraphLayoutResult = {
    boxes: Array<{ id: string; x: number; y: number; w: number; h: number }>;
    routes: Array<{ id: string; from: string; to: string; points: Array<{ x: number; y: number }> }>;
    bounds: { x: number; y: number; width: number; height: number };
    metadata: { algorithm: string; engine: string; routing: "straight" | "orthogonal"; warnings: string[] };
};
