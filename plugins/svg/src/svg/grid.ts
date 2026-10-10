// Think in cells, not in pixels.
//
// Every wireframe is a grid underneath — a rail, a column, a panel; a header
// band, a feed, a composer. Written as coordinates that structure is invisible
// and each edit is arithmetic. Written as `g.cell({ col: 1, row: 2, colSpan: 2 })`
// it is the structure itself, and moving a divider moves everything attached.
//
// The track syntax is CSS grid's, cut down to what a drawing needs: a number is
// pixels, `1fr` is a share of what is left, `auto` is an equal share of it.
// There is no content-based sizing — in SVG nothing reports how big a child is,
// so `auto` cannot mean what it means in CSS and is honest about it.

/** One placed cell, carrying every edge and centre a caller would recompute. */
type Cell = {
    x: number; y: number; w: number; h: number;
    /** Alias of w, so a cell can be spread straight onto a <rect>. */
    width: number;
    /** Alias of h, so a cell can be spread straight onto a <rect>. */
    height: number;
    cx: number; cy: number; right: number; bottom: number;
};

/** Build a cell from its edges, with both spellings of its size. */
function cellOf(x: number, y: number, w: number, h: number): Cell {
    return { x, y, w, h, width: w, height: h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h };
}

/** Resolve a track list — numbers, "1fr", "auto", "25%" — against a total size. */
function resolve(tracks: Array<number | string>, total: number, gap: number): number[] {
    const gaps = gap * Math.max(0, tracks.length - 1);
    const free = total - gaps;
    const fixed = tracks.map(t => {
        if (typeof t === "number") return t;
        const s = String(t).trim();
        if (s.endsWith("%")) return free * Number.parseFloat(s) / 100;
        if (/^\d*\.?\d+$/.test(s)) return Number.parseFloat(s);
        return NaN; // fr or auto — shares of the remainder
    });
    const flex = tracks.map((t, i) => {
        if (!Number.isNaN(fixed[i]!)) return 0;
        const s = String(t).trim();
        return s === "auto" ? 1 : Number.parseFloat(s) || 1;
    });

    const used = fixed.reduce((sum, v) => sum + (Number.isNaN(v) ? 0 : v), 0);
    const totalFlex = flex.reduce((a, b) => a + b, 0);
    const remainder = Math.max(0, free - used);
    return fixed.map((v, i) => (Number.isNaN(v) ? (totalFlex ? remainder * flex[i]! / totalFlex : 0) : v));
}

/**
 * Builds a CSS-like grid over a region and places boxes in its cells.
 *
 * Use for any drawing with structure — a wireframe, a dashboard, a layered
 * architecture diagram, a comparison table. Tracks are given CSS-grid style:
 * a number is pixels, `"2fr"` takes twice the leftover space of `"1fr"`,
 * `"auto"` splits it evenly, `"25%"` is a share of the free space. Call `cell`
 * for a box spanning one or more tracks, or `area` to place by a name declared
 * in `areas`; both return x/y/w/h plus cx/cy/right/bottom, so text centres and
 * neighbours attach without arithmetic. `pad` insets a cell on all sides, which
 * is how a card gets its margin without a second set of numbers. Nest by
 * passing a cell's box as the region of another grid.
 * @param opts.cols Column tracks: pixels, "1fr", "auto" or "25%". @default ["1fr"]
 * @param opts.rows Row tracks, same syntax as cols. @default ["1fr"]
 * @param opts.width Total width of the grid region, including gaps. @minimum 1
 * @param opts.height Total height of the grid region, including gaps. @minimum 1
 * @param opts.x Left edge of the region. @default 0
 * @param opts.y Top edge of the region. @default 0
 * @param opts.gap Space between tracks; gapX/gapY override per axis. @default 0
 * @param opts.gapX Horizontal space between columns, overriding gap.
 * @param opts.gapY Vertical space between rows, overriding gap.
 * @param opts.areas Named areas, one string of space-separated names per row, CSS-grid style.
 * @returns cell/area placement functions, the resolved track sizes, every named area, and the region itself.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Column tracks: pixels, "1fr", "auto" or "25%". @default ["1fr"] */
    cols?: Array<number | string>;
    /** Row tracks, same syntax as cols. @default ["1fr"] */
    rows?: Array<number | string>;
    /** Total width of the grid region, including gaps. @minimum 1 */
    width: number;
    /** Total height of the grid region, including gaps. @minimum 1 */
    height: number;
    /** Left edge of the region. @default 0 */
    x?: number;
    /** Top edge of the region. @default 0 */
    y?: number;
    /** Space between tracks; gapX/gapY override per axis. @default 0 */
    gap?: number;
    /** Horizontal space between columns, overriding gap. */
    gapX?: number;
    /** Vertical space between rows, overriding gap. */
    gapY?: number;
    /** Named areas, one string of space-separated names per row, CSS-grid style. */
    areas?: string[];
}): {
    cell: (at: { col?: number; row?: number; colSpan?: number; rowSpan?: number; pad?: number }) => Cell;
    area: (name: string, pad?: number) => Cell;
    areas: Record<string, Cell>;
    colSizes: number[];
    rowSizes: number[];
    x: number; y: number; width: number; height: number;
} {
    const cols = opts.cols?.length ? opts.cols : ["1fr"];
    const rows = opts.rows?.length ? opts.rows : ["1fr"];
    const gapX = Number(opts.gapX ?? opts.gap ?? 0);
    const gapY = Number(opts.gapY ?? opts.gap ?? 0);
    const x0 = Number(opts.x ?? 0), y0 = Number(opts.y ?? 0);

    const colSizes = resolve(cols, Number(opts.width), gapX);
    const rowSizes = resolve(rows, Number(opts.height), gapY);

    // Offsets are prefix sums, so a span is just "sum of the tracks it covers
    // plus the gaps swallowed inside it" — a gap inside a span belongs to the
    // span, which is exactly what CSS grid does.
    const offsets = (sizes: number[], gap: number) => {
        const out: number[] = [];
        let at = 0;
        for (const size of sizes) { out.push(at); at += size + gap; }
        return out;
    };
    const colAt = offsets(colSizes, gapX);
    const rowAt = offsets(rowSizes, gapY);

    const make = (col: number, row: number, colSpan: number, rowSpan: number, pad: number): Cell => {
        // Clamping a bad index hides a typo: `col: 9` in a three-column grid
        // used to quietly draw in the last column, and the drawing looked
        // plausible. An error naming the mistake is cheaper than finding it by
        // eye later.
        if (!Number.isInteger(col) || col < 0 || col >= colSizes.length) {
            throw new Error(`svg: grid has ${colSizes.length} columns (0..${colSizes.length - 1}), asked for col ${col}`);
        }
        if (!Number.isInteger(row) || row < 0 || row >= rowSizes.length) {
            throw new Error(`svg: grid has ${rowSizes.length} rows (0..${rowSizes.length - 1}), asked for row ${row}`);
        }
        if (!Number.isInteger(colSpan) || colSpan < 1 || col + colSpan > colSizes.length) {
            throw new Error(`svg: colSpan ${colSpan} from col ${col} runs past the last column (${colSizes.length - 1})`);
        }
        if (!Number.isInteger(rowSpan) || rowSpan < 1 || row + rowSpan > rowSizes.length) {
            throw new Error(`svg: rowSpan ${rowSpan} from row ${row} runs past the last row (${rowSizes.length - 1})`);
        }
        const c = col, r = row, cs = colSpan, rs = rowSpan;
        let w = 0, h = 0;
        for (let i = 0; i < cs; i++) w += colSizes[c + i]! + (i ? gapX : 0);
        for (let i = 0; i < rs; i++) h += rowSizes[r + i]! + (i ? gapY : 0);
        return cellOf(x0 + colAt[c]! + pad, y0 + rowAt[r]! + pad, Math.max(0, w - pad * 2), Math.max(0, h - pad * 2));
    };

    // A named area is the bounding box of every cell carrying that name, which
    // lets one string per row describe a whole wireframe.
    const named: Record<string, Cell> = {};
    const rowNames = (opts.areas ?? []).map(line => String(line).trim().split(/\s+/));
    for (let r = 0; r < rowNames.length; r++) {
        // An areas block that disagrees with the tracks is always a mistake, and
        // silently ignoring the extra names produces a drawing missing a panel.
        if (r >= rowSizes.length) throw new Error(`svg: areas describe ${rowNames.length} rows but the grid has ${rowSizes.length}`);
        if (rowNames[r]!.length !== colSizes.length) {
            throw new Error(`svg: areas row ${r} names ${rowNames[r]!.length} cells but the grid has ${colSizes.length} columns`);
        }
        for (let c = 0; c < rowNames[r]!.length; c++) {
            const name = rowNames[r]![c]!;
            if (name === "." || !name) continue;
            const span = make(c, r, 1, 1, 0);
            const seen = named[name];
            named[name] = seen
                ? cellOf(
                    Math.min(seen.x, span.x),
                    Math.min(seen.y, span.y),
                    Math.max(seen.right, span.right) - Math.min(seen.x, span.x),
                    Math.max(seen.bottom, span.bottom) - Math.min(seen.y, span.y),
                )
                : span;
        }
    }

    return {
        cell: (at) => make(Number(at?.col ?? 0), Number(at?.row ?? 0), Number(at?.colSpan ?? 1), Number(at?.rowSpan ?? 1), Number(at?.pad ?? 0)),
        area: (name, pad = 0) => {
            const box = named[name];
            if (!box) {
                const known = Object.keys(named).sort().join(", ") || "none declared";
                throw new Error(`svg: no grid area named "${name}" (have: ${known})`);
            }
            if (!pad) return box;
            return cellOf(box.x + pad, box.y + pad, Math.max(0, box.w - pad * 2), Math.max(0, box.h - pad * 2));
        },
        areas: named,
        colSizes,
        rowSizes,
        x: x0, y: y0, width: Number(opts.width), height: Number(opts.height),
    };
}
