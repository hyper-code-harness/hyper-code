/**
 * Assigns existing graph boxes to unique grid cells with globally minimum affine displacement
 *
 * Use after ACA layoutIncremental for a bounded near-square grid of unchanged-size cards. Chooses columns by abs(log(rows/columns)), then cell count, then fewer columns; square means grid counts, not pixel bounds; affine-normalizes source centers independently per axis and uses rectangular Hungarian minimum squared-distance assignment. At most 60 boxes and 1200 cells. Empty cells are allowed; original ordering/topology need not survive. Recomputes actual box bounds and straight border-clipped routes, not obstacle-avoiding routes. Input is not mutated.
 * @param opts.layout Materialized geometry with at most 60 unique boxes and 300 unique edges. Finite coordinates within +/-1e9, positive dimensions up to 1000000; edge endpoints must exist and differ. Old bounds, metadata and route geometry are discarded.
 * @param opts.gapX Horizontal spacing between max-width cells. @default 50 @minimum 0 @maximum 1000000
 * @param opts.gapY Vertical spacing between max-height cells. @default 50 @minimum 0 @maximum 1000000
 * @param opts.occupancy Target fill ratio; requests M=ceil(N/occupancy) cells before rounding rows. Actual fill can be lower. @default 1 @minimum 0.1 @maximum 1
 * @param opts.columns Integer fixed column count instead of aspect search; for nonempty input cannot exceed M. Empty input returns empty geometry. @minimum 1 @maximum 600
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Materialized geometry with at most 60 unique boxes and 300 unique edges. Finite coordinates within +/-1e9, positive dimensions up to 1000000; edge endpoints must exist and differ. Old bounds, metadata and route geometry are discarded. */
        layout: types.svg.GraphLayoutResult;
        /** Horizontal spacing between max-width cells. @default 50 @minimum 0 @maximum 1000000 */
        gapX?: number;
        /** Vertical spacing between max-height cells. @default 50 @minimum 0 @maximum 1000000 */
        gapY?: number;
        /** Target fill ratio; requests M=ceil(N/occupancy) cells before rounding rows. Actual fill can be lower. @default 1 @minimum 0.1 @maximum 1 */
        occupancy?: number;
        /** Integer fixed column count instead of aspect search; for nonempty input cannot exceed M. Empty input returns empty geometry. @minimum 1 @maximum 600 */
        columns?: number;
    },
): Promise<types.svg.GraphLayoutResult> {
    const { layout, gapX = 50, gapY = 50, occupancy = 1, columns } = opts;
    if (!Number.isFinite(gapX) || gapX < 0 || gapX > 1e6 || !Number.isFinite(gapY) || gapY < 0 || gapY > 1e6) throw new Error('gapX/gapY must be finite in [0, 1000000]');
    if (!Number.isFinite(occupancy) || occupancy < 0.1 || occupancy > 1) throw new Error('occupancy must be in [0.1, 1]');
    if (columns !== undefined && (!Number.isInteger(columns) || columns < 1 || columns > 600)) throw new Error('columns must be an integer in [1, 600]');
    if (!layout || !Array.isArray(layout.boxes) || layout.boxes.length > 60 || !Array.isArray(layout.routes) || layout.routes.length > 300) throw new Error('Expected up to 60 boxes and 300 routes');
    const ids = new Set<string>();
    for (const b of layout.boxes) {
        if (!b || typeof b.id !== 'string' || !b.id || ids.has(b.id) || !Number.isFinite(b.x) || !Number.isFinite(b.y) || Math.abs(b.x) > 1e9 || Math.abs(b.y) > 1e9 || !Number.isFinite(b.w) || !Number.isFinite(b.h) || b.w <= 0 || b.h <= 0 || b.w > 1e6 || b.h > 1e6) throw new Error('Invalid box geometry or duplicate ID');
        ids.add(b.id);
    }
    const edgeIds = new Set<string>();
    for (const e of layout.routes) {
        if (!e || typeof e.id !== 'string' || !e.id || edgeIds.has(e.id) || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) throw new Error('Invalid edge ID/endpoints; self-loops unsupported');
        edgeIds.add(e.id);
    }
    const metadata: types.svg.GraphLayoutResult['metadata'] = {algorithm:'affine-grid-hungarian',engine:'svg.snapLayoutToGrid',routing:'straight',warnings:['Straight border-clipped routes are not obstacle-avoiding; edges may cross boxes or other edges. Grid assignment may change ACA ordering and topology.']};
    const n = layout.boxes.length;
    if (!n) return { boxes: [], routes: [], bounds: { x: 0, y: 0, width: 0, height: 0 }, metadata };
    const m = Math.ceil(n / occupancy);
    if (columns !== undefined && columns > m) throw new Error('columns must not exceed ceil(N / occupancy)');
    const maxW = Math.max(...layout.boxes.map(b => b.w)), maxH = Math.max(...layout.boxes.map(b => b.h));
    let c = 1, r = m, best = Infinity, bestCells = Infinity;
    for (let candidate = columns ?? 1; candidate <= (columns ?? m); candidate++) {
        const rows = Math.ceil(m / candidate);
        const score = Math.abs(Math.log(rows / candidate)), count = rows * candidate;
        if (score < best - 1e-12 || (Math.abs(score - best) <= 1e-12 && count < bestCells)) { c = candidate; r = rows; best = score; bestCells = count; }
    }
    const cells = c * r; // <= 1198 for M <= 600, including final-row slack.
    if (cells > 1200) throw new Error('Grid exceeds 1200 cells');
    const centers = layout.boxes.map(b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }));
    const minX = Math.min(...centers.map(p => p.x)), maxX = Math.max(...centers.map(p => p.x));
    const minY = Math.min(...centers.map(p => p.y)), maxY = Math.max(...centers.map(p => p.y));
    const spanX = (c - 1) * (maxW + gapX), spanY = (r - 1) * (maxH + gapY);
    const targets = centers.map(p => ({x: maxW / 2 + (maxX === minX ? 0.5 : (p.x - minX) / (maxX - minX)) * spanX, y: maxH / 2 + (maxY === minY ? 0.5 : (p.y - minY) / (maxY - minY)) * spanY}));
    const grid = Array.from({length: cells}, (_, j) => ({x: maxW / 2 + (j % c) * (maxW + gapX), y: maxH / 2 + Math.floor(j / c) * (maxH + gapY)}));
    const costs = targets.map(t => grid.map(g => (t.x - g.x) ** 2 + (t.y - g.y) ** 2));
    // Rectangular Hungarian: row potentials u, column potentials v, matching p.
    // Scan original input order and row-major cells; strict comparisons break ties deterministically.
    const u = new Float64Array(n + 1), v = new Float64Array(cells + 1), p = new Int32Array(cells + 1), way = new Int32Array(cells + 1);
    for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Float64Array(cells + 1).fill(Infinity), used = new Uint8Array(cells + 1);
        do {
            used[j0] = 1;
            const i0 = p[j0]!;
            let delta = Infinity, j1 = 0;
            for (let j = 1; j <= cells; j++) if (!used[j]) {
                const cur = costs[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
                if (cur < minv[j]!) { minv[j] = cur; way[j] = j0; }
                if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
            }
            for (let j = 0; j <= cells; j++) {
                if (used[j]) { u[p[j]!] = u[p[j]!]! + delta; v[j] = v[j]! - delta; }
                else minv[j] = minv[j]! - delta;
            }
            j0 = j1;
        } while (p[j0] !== 0);
        do { const j1 = way[j0]!; p[j0] = p[j1]!; j0 = j1; } while (j0 !== 0);
    }
    const assigned = new Int32Array(n);
    for (let j = 1; j <= cells; j++) if (p[j]) assigned[p[j]! - 1] = j - 1;
    const boxes = layout.boxes.map((b, i) => ({...b, x: grid[assigned[i]!]!.x - b.w / 2, y: grid[assigned[i]!]!.y - b.h / 2}));
    const byId = new Map(boxes.map(b => [b.id, b]));
    const routes = layout.routes.map(e => {
        const a = byId.get(e.from)!, b = byId.get(e.to)!;
        const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
        const dx = bx - ax, dy = by - ay;
        const ta = 1 / Math.max(Math.abs(dx) / (a.w / 2), Math.abs(dy) / (a.h / 2));
        const tb = 1 / Math.max(Math.abs(dx) / (b.w / 2), Math.abs(dy) / (b.h / 2));
        return {id:e.id, from:e.from, to:e.to, points:[{x:ax + dx * ta, y:ay + dy * ta}, {x:bx - dx * tb, y:by - dy * tb}]};
    });
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return {boxes, routes, bounds:{x, y, width:Math.max(...boxes.map(b => b.x + b.w)) - x, height:Math.max(...boxes.map(b => b.y + b.h)) - y}, metadata};
}
