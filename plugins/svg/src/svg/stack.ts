// "Put these three things in that cell, pushed apart."
//
// `layout` places a row from a point: it knows where the first box starts and
// adds a gap between the rest. What it cannot do is the thing a wireframe asks
// for constantly — distribute items inside a region that is already known. A
// toolbar has an icon at the left and an action at the right; a footer has a
// label and a page count; a legend wraps onto a second line when it runs out of
// room. All of that is one question: given a box, where do the children go.
//
// The model is Figma's auto-layout, which the survey found to be the smallest
// complete set: a direction, a gap, alignment along the main axis (justify),
// alignment across it (align), and wrapping. `box` is what makes it different
// from `layout` — with a region to fill, space-between and centring mean
// something.

type Box = { x: number; y: number; w?: number; h?: number; width?: number; height?: number };

/** One placed item, in the shape every other helper here returns. */
type Placed = {
    id: string; x: number; y: number; w: number; h: number;
    /** Alias of w, so a box can be spread straight onto a <rect>. */
    width: number;
    /** Alias of h, so a box can be spread straight onto a <rect>. */
    height: number;
    cx: number; cy: number; right: number; bottom: number;
    /** Which wrapped line this item landed on, 0 for the first. */
    line: number;
};

/**
 * Distributes items inside a box along one axis, with gaps, alignment and wrapping.
 *
 * Use when the region is known and the items must share it: a toolbar with
 * something at each end (`justify: "space-between"`), a centred button row, a
 * legend that wraps onto a second line, a column of cards that hugs its
 * content. Each item gives its own size and an optional id; `fill` makes items
 * share the remaining space equally instead of keeping their width. Returns a
 * box per item with x/y/w/h plus cx/cy/right/bottom, so text and nested grids
 * attach without arithmetic, and reports the total size so a caller can grow
 * the region when the content does not fit. Prefer this over svg.layout
 * whenever the available space matters rather than just the starting point.
 * @param opts.items The items to place, each with its own size and optional id.
 * @param opts.box The region to distribute inside; omit to place from x/y like a plain row.
 * @param opts.x Left edge when no box is given. @default 0
 * @param opts.y Top edge when no box is given. @default 0
 * @param opts.direction Axis to lay out along. @default "row"
 * @param opts.gap Minimum space between items, in pixels. @default 8
 * @param opts.justify Distribution along the main axis; needs a box for anything but "start". @default "start"
 * @param opts.align Alignment across the axis. @default "start"
 * @param opts.wrap Start a new line when an item would overflow the box. @default false
 * @param opts.pad Inset inside the box on every side. @default 0
 * @param opts.fill Make items share the free space equally along the main axis. @default false
 * @returns A box per item, the total size used, and whether it fit the region.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** The items to place, each with its own size and optional id. */
    items: Array<{ id?: string; w?: number; h?: number; width?: number; height?: number }>;
    /** The region to distribute inside; omit to place from x/y like a plain row. */
    box?: Box;
    /** Left edge when no box is given. @default 0 */
    x?: number;
    /** Top edge when no box is given. @default 0 */
    y?: number;
    /** Axis to lay out along. @default "row" */
    direction?: "row" | "column";
    /** Minimum space between items, in pixels. @default 8 */
    gap?: number;
    /** Distribution along the main axis; needs a box for anything but "start". @default "start" */
    justify?: "start" | "center" | "end" | "space-between" | "space-around";
    /** Alignment across the axis. @default "start" */
    align?: "start" | "center" | "end" | "stretch";
    /** Start a new line when an item would overflow the box. @default false */
    wrap?: boolean;
    /** Inset inside the box on every side. @default 0 */
    pad?: number;
    /** Make items share the free space equally along the main axis. @default false */
    fill?: boolean;
}): { boxes: Placed[]; width: number; height: number; fits: boolean } {
    const row = (opts.direction ?? "row") !== "column";
    const gap = Number(opts.gap ?? 8);
    const pad = Number(opts.pad ?? 0);
    const justify = opts.justify ?? "start";
    const align = opts.align ?? "start";

    const originX = Number(opts.box?.x ?? opts.x ?? 0) + pad;
    const originY = Number(opts.box?.y ?? opts.y ?? 0) + pad;
    const regionW = opts.box ? Number(opts.box.w ?? opts.box.width ?? 0) - pad * 2 : Infinity;
    const regionH = opts.box ? Number(opts.box.h ?? opts.box.height ?? 0) - pad * 2 : Infinity;
    // Along the axis: how much room there is to distribute in. Across it: how
    // much room there is to align against.
    const mainRoom = row ? regionW : regionH;
    const crossRoom = row ? regionH : regionW;

    const sizes = opts.items.map((item, i) => ({
        id: item.id ?? String(i),
        main: Number((row ? item.w ?? item.width : item.h ?? item.height) ?? 0),
        cross: Number((row ? item.h ?? item.height : item.w ?? item.width) ?? 0),
    }));

    // Wrapping decides the lines first, because justify and align both operate
    // per line: a wrapped legend centres each row on its own, which is what
    // makes it read as rows rather than as one ragged block.
    const lines: Array<typeof sizes> = [];
    if (opts.wrap && Number.isFinite(mainRoom)) {
        let current: typeof sizes = [];
        let used = 0;
        for (const size of sizes) {
            const extra = current.length ? gap + size.main : size.main;
            if (current.length && used + extra > mainRoom) { lines.push(current); current = [size]; used = size.main; }
            else { current.push(size); used += extra; }
        }
        if (current.length) lines.push(current);
    } else {
        lines.push(sizes);
    }

    const boxes: Placed[] = [];
    let crossCursor = 0;
    let widestLine = 0;

    for (const [lineIndex, line] of lines.entries()) {
        const lineCross = Math.max(0, ...line.map(s => s.cross));
        const content = line.reduce((sum, s) => sum + s.main, 0);

        // `fill` is Figma's FILL sizing: forget the asked widths and share the
        // room. Done before justify, because afterwards there is nothing left
        // to distribute.
        const mains = line.map(s => s.main);
        if (opts.fill && Number.isFinite(mainRoom) && line.length) {
            const each = (mainRoom - gap * (line.length - 1)) / line.length;
            for (let i = 0; i < mains.length; i++) mains[i] = Math.max(0, each);
        }
        const filled = mains.reduce((sum, m) => sum + m, 0);
        const free = Number.isFinite(mainRoom) ? mainRoom - filled - gap * (line.length - 1) : 0;

        // space-between hands the slack to the gaps, space-around also puts a
        // half gap at each end; the rest just move the whole block.
        let cursor = 0;
        let between = gap;
        if (free > 0 && line.length) {
            if (justify === "center") cursor = free / 2;
            else if (justify === "end") cursor = free;
            else if (justify === "space-between" && line.length > 1) between = gap + free / (line.length - 1);
            else if (justify === "space-around") { between = gap + free / line.length; cursor = (between - gap) / 2; }
        }

        for (const [i, size] of line.entries()) {
            const main = mains[i]!;
            const cross = align === "stretch" && Number.isFinite(crossRoom) && lines.length === 1 ? crossRoom : size.cross;
            const slack = Math.max(0, lineCross - cross);
            const crossOffset = crossCursor + (align === "center" ? slack / 2 : align === "end" ? slack : 0);

            const x = row ? originX + cursor : originX + crossOffset;
            const y = row ? originY + crossOffset : originY + cursor;
            const w = row ? main : cross;
            const h = row ? cross : main;
            boxes.push({
                id: size.id, x, y, w, h, width: w, height: h,
                cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h,
                line: lineIndex,
            });
            cursor += main + (i < line.length - 1 ? between : 0);
        }

        widestLine = Math.max(widestLine, cursor);
        crossCursor += lineCross + (lineIndex < lines.length - 1 ? gap : 0);
    }

    const width = row ? widestLine : crossCursor;
    const height = row ? crossCursor : widestLine;
    return {
        boxes,
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
        fits: (!Number.isFinite(mainRoom) || widestLine <= mainRoom + 0.01) && (!Number.isFinite(crossRoom) || crossCursor <= crossRoom + 0.01),
    };
}
