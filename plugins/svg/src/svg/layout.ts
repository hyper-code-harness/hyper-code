// Place a row or a column once, instead of writing y + i * 62 six times.
//
// Hand-computed offsets are where drawings rot: insert one item and every
// number after it is wrong. This turns a list of sizes into a list of boxes,
// each with its corner and its centre, so the drawing reads `b.x` instead of
// arithmetic. Nest it — a column of rows — and a whole panel lays itself out.

/** One placed box, with everything a caller would otherwise recompute. */
type Placed = {
    id: string; x: number; y: number; w: number; h: number;
    /** Alias of w, so a box can be spread straight onto a <rect>. */
    width: number;
    /** Alias of h, so a box can be spread straight onto a <rect>. */
    height: number;
    cx: number; cy: number; right: number; bottom: number;
};

/**
 * Lays out a row or a column of boxes, returning the position of each one.
 *
 * Use instead of writing the offsets by hand whenever several shapes sit in a
 * line: stacked panel sections, a legend, a toolbar, bars of a chart. Items are
 * placed from (x, y) along the direction with `gap` between them, and each
 * result carries x/y/w/h plus cx/cy/right/bottom so text can be centred and
 * neighbours attached without arithmetic. Items missing a size inherit
 * itemWidth/itemHeight, so a uniform stack needs only a count. The total size
 * of the arrangement is returned too, ready for the parent box.
 * @param opts.items Boxes to place, in order; each may set its own w/h/id.
 * @param opts.x Left edge of the arrangement. @default 0
 * @param opts.y Top edge of the arrangement. @default 0
 * @param opts.direction Lay items left-to-right or top-to-bottom. @default "column"
 * @param opts.gap Space between consecutive items, in pixels. @default 8
 * @param opts.itemWidth Default width for items that do not give one. @default 100
 * @param opts.itemHeight Default height for items that do not give one. @default 24
 * @param opts.align Cross-axis alignment: start, center, end or stretch to the widest. @default "start"
 * @returns Every placed box plus the total width and height of the arrangement.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Boxes to place, in order; each may set its own w/h/id. */
    items: Array<{ id?: string; w?: number; h?: number }>;
    /** Left edge of the arrangement. @default 0 */
    x?: number;
    /** Top edge of the arrangement. @default 0 */
    y?: number;
    /** Lay items left-to-right or top-to-bottom. @default "column" */
    direction?: "row" | "column";
    /** Space between consecutive items, in pixels. @default 8 */
    gap?: number;
    /** Default width for items that do not give one. @default 100 */
    itemWidth?: number;
    /** Default height for items that do not give one. @default 24 */
    itemHeight?: number;
    /** Cross-axis alignment: start, center, end or stretch to the widest. @default "start" */
    align?: "start" | "center" | "end" | "stretch";
}): { boxes: Placed[]; width: number; height: number } {
    const items = Array.isArray(opts.items) ? opts.items : [];
    const x0 = Number(opts.x ?? 0), y0 = Number(opts.y ?? 0);
    const gap = Number(opts.gap ?? 8);
    const row = opts.direction === "row";
    const align = opts.align ?? "start";

    const sized = items.map((item, i) => ({
        id: item?.id ?? String(i),
        w: Number(item?.w ?? opts.itemWidth ?? 100),
        h: Number(item?.h ?? opts.itemHeight ?? 24),
    }));

    // The cross axis is as wide as the widest item; "stretch" then gives that
    // width to everyone, which is what a panel of sections wants.
    const cross = Math.max(0, ...sized.map(s => (row ? s.h : s.w)));

    let cursor = row ? x0 : y0;
    const boxes: Placed[] = sized.map(s => {
        const size = row ? s.h : s.w;
        const span = align === "stretch" ? cross : size;
        const offset = align === "center" ? (cross - span) / 2 : align === "end" ? cross - span : 0;
        const x = row ? cursor : x0 + offset;
        const y = row ? y0 + offset : cursor;
        const w = row ? s.w : span;
        const h = row ? span : s.h;
        cursor += (row ? s.w : s.h) + gap;
        return { id: s.id, x, y, w, h, width: w, height: h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h };
    });

    const main = Math.max(0, cursor - (row ? x0 : y0) - (boxes.length ? gap : 0));
    return { boxes, width: row ? main : cross, height: row ? cross : main };
}
