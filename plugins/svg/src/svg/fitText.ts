// The one loop that was still open: measured, wrapped — but did it fit?
//
// `label` wraps to a width and reports how tall it came out. Nobody checked
// that against the box the text has to live in, so a long caption still burst
// out of a card and the drawing looked broken in a way no helper admitted to.
// This closes it: given a box, try the asked size, shrink while it overflows,
// and if shrinking is not allowed say so instead of drawing over the neighbour.
//
// The option set is Observable Plot's, which is the smallest sufficient one
// found in the survey: a wrap width, a line cap, and a decision about what to
// do when it still does not fit — shrink, clip, or ellipsise.

/** A box in the shape every other helper here returns. */
type Box = { x: number; y: number; w?: number; h?: number; width?: number; height?: number };

const ELLIPSIS = "…";

/**
 * Fits text into a box, shrinking or truncating it until it actually fits.
 *
 * Use for any text whose length is not known while drawing — a title from a
 * row, a user's name, a file path in a card. The text is wrapped to the box
 * width and checked against its height; `overflow` decides the rest: "shrink"
 * steps the font down to minSize, "ellipsis" cuts the last line with …,
 * "ellipsis-middle" keeps both ends (right for paths), "clip" drops the extra
 * lines, and "none" draws it as-is and only reports. The result says whether it
 * fits and by how much it misses, so a drawing can fail loudly rather than
 * silently ugly. Returns a ready node positioned inside the box, vertically
 * centred or top-aligned per `valign`.
 * @param opts.text The text to fit.
 * @param opts.box Target box: x, y and w/h (width/height accepted too).
 * @param opts.size Starting font size in pixels. @default 12 @minimum 1
 * @param opts.minSize Smallest font size "shrink" may use. @default 8 @minimum 1
 * @param opts.maxLines Hard cap on line count; extra lines are truncated.
 * @param opts.overflow What to do when the text still does not fit. @default "shrink"
 * @param opts.pad Inset inside the box on every side, in pixels. @default 0
 * @param opts.align Horizontal alignment inside the box. @default "start"
 * @param opts.valign Vertical placement inside the box. @default "top"
 * @param opts.fill Text colour, any CSS colour. @default "#333"
 * @param opts.weight Font weight. @default 400
 * @param opts.lineHeight Line spacing as a multiple of the font size. @default 1.3
 * @param opts.font Font family for the text element. @default "Inter, system-ui, sans-serif"
 * @param opts.exact Pin every line to its measured width with textLength, so the drawn text cannot exceed the box. @default true
 * @returns The node, the size and lines it settled on, whether it fits and the overflow in pixels.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The text to fit. */
    text: string;
    /** Target box: x, y and w/h (width/height accepted too). */
    box: Box;
    /** Starting font size in pixels. @default 12 @minimum 1 */
    size?: number;
    /** Smallest font size "shrink" may use. @default 8 @minimum 1 */
    minSize?: number;
    /** Hard cap on line count; extra lines are truncated. */
    maxLines?: number;
    /** What to do when the text still does not fit. @default "shrink" */
    overflow?: "shrink" | "clip" | "ellipsis" | "ellipsis-middle" | "none";
    /** Inset inside the box on every side, in pixels. @default 0 */
    pad?: number;
    /** Horizontal alignment inside the box. @default "start" */
    align?: "start" | "center" | "end";
    /** Vertical placement inside the box. @default "top" */
    valign?: "top" | "center" | "bottom";
    /** Text colour, any CSS colour. @default "#333" */
    fill?: string;
    /** Font weight. @default 400 */
    weight?: number;
    /** Line spacing as a multiple of the font size. @default 1.3 */
    lineHeight?: number;
    /** Font family for the text element. @default "Inter, system-ui, sans-serif" */
    font?: string;
    /** Pin every line to its measured width with textLength, so the drawn text cannot exceed the box. @default true */
    exact?: boolean;
}): { node: types.svg.Node; size: number; lines: string[]; fits: boolean; overflowBy: { x: number; y: number }; box: { x: number; y: number; w: number; h: number } } {
    const text = String(opts.text ?? "");
    const pad = Number(opts.pad ?? 0);
    const bw = Number(opts.box?.w ?? opts.box?.width ?? 0) - pad * 2;
    const bh = Number(opts.box?.h ?? opts.box?.height ?? 0) - pad * 2;
    if (!(bw > 0)) throw new Error("svg: fitText needs a box with a positive width");
    const bx = Number(opts.box?.x ?? 0) + pad;
    const by = Number(opts.box?.y ?? 0) + pad;

    const start = Number(opts.size ?? 12);
    const minSize = Math.min(Number(opts.minSize ?? 8), start);
    const overflow = opts.overflow ?? "shrink";
    const weight = Number(opts.weight ?? 400);
    const lineHeight = Number(opts.lineHeight ?? 1.3);

    const measure = (s: string, size: number) => ctx.fns.svg.measureText({ text: s, size, weight }).width;

    // Wrapping is label's rule, repeated here because the answer is needed
    // before a node exists: break on spaces, never inside a word.
    const wrap = (size: number): string[] => {
        const out: string[] = [];
        for (const paragraph of text.split("\n")) {
            let current = "";
            for (const word of paragraph.split(/\s+/).filter(Boolean)) {
                const candidate = current ? `${current} ${word}` : word;
                if (current && measure(candidate, size) > bw) { out.push(current); current = word; }
                else current = candidate;
            }
            out.push(current);
        }
        return out;
    };

    const heightOf = (count: number, size: number) => size * lineHeight * (count - 1) + size;
    const capacity = (size: number) => (bh > 0 ? Math.max(1, Math.floor((bh - size) / (size * lineHeight)) + 1) : Infinity);

    // Shrink first if allowed: a smaller font that fits beats a truncated one.
    let size = start;
    let lines = wrap(size);
    if (overflow === "shrink") {
        while (size > minSize) {
            const allowed = Math.min(capacity(size), opts.maxLines ?? Infinity);
            const widest = Math.max(0, ...lines.map(l => measure(l, size)));
            if (lines.length <= allowed && widest <= bw) break;
            size = Math.max(minSize, Math.round((size - 0.5) * 2) / 2);
            lines = wrap(size);
        }
    }

    const allowed = Math.min(capacity(size), opts.maxLines ?? Infinity);

    // Truncation happens on the last line that is kept, so the ellipsis sits
    // where the text was actually cut rather than at the end of the string.
    // "shrink" and "none" never cut: one has already used its only lever, the
    // other was asked to report rather than to fix, and a cut that is reported
    // as a fit is the bug this helper exists to prevent.
    const mayCut = overflow === "clip" || overflow === "ellipsis" || overflow === "ellipsis-middle";
    if (mayCut && lines.length > allowed && Number.isFinite(allowed)) {
        const kept = lines.slice(0, allowed);
        if (overflow !== "clip") {
            const dropped = lines.slice(allowed).join(" ");
            const last = `${kept[kept.length - 1]} ${dropped}`;
            kept[kept.length - 1] = truncate(last, bw, size, overflow === "ellipsis-middle" ? "middle" : "end", measure);
        }
        lines = kept;
    }
    // A single word wider than the box is a different failure, and ellipsis is
    // the only honest answer — shrinking already had its chance above.
    if (overflow === "ellipsis" || overflow === "ellipsis-middle") {
        lines = lines.map(l => (measure(l, size) > bw ? truncate(l, bw, size, overflow === "ellipsis-middle" ? "middle" : "end", measure) : l));
    }

    const usedWidth = Math.max(0, ...lines.map(l => measure(l, size)));
    const usedHeight = heightOf(lines.length, size);
    const overflowBy = {
        x: Math.round(Math.max(0, usedWidth - bw) * 100) / 100,
        y: Math.round(Math.max(0, bh > 0 ? usedHeight - bh : 0) * 100) / 100,
    };

    const x = opts.align === "center" ? bx + bw / 2 : opts.align === "end" ? bx + bw : bx;
    const free = Math.max(0, bh - usedHeight);
    const top = opts.valign === "center" ? by + free / 2 : opts.valign === "bottom" ? by + free : by;
    // y is a baseline, so the first line sits one ascent below the top edge.
    const baseline = top + size * 0.8;

    const node = ctx.fns.svg.label({
        text: lines.join("\n"),
        x, y: baseline,
        size, weight,
        fill: opts.fill,
        font: opts.font,
        lineHeight,
        anchor: opts.align === "center" ? "middle" : opts.align === "end" ? "end" : "start",
        // On by default here, unlike in label: the whole point of fitText is
        // that `fits` is true, and without textLength that promise holds only
        // for the font we guessed with.
        exact: opts.exact !== false,
    }).node;

    return {
        node, size, lines,
        fits: overflowBy.x === 0 && overflowBy.y === 0,
        overflowBy,
        box: { x: bx, y: top, w: Math.round(usedWidth * 100) / 100, h: Math.round(usedHeight * 100) / 100 },
    };
}

/** Cut a line to a width, keeping the end (paths) or just the start. */
function truncate(line: string, maxWidth: number, size: number, where: "end" | "middle", measure: (s: string, size: number) => number): string {
    if (measure(line, size) <= maxWidth) return line;
    if (where === "middle") {
        let head = Math.ceil(line.length / 2), tail = line.length - head;
        while (head + tail > 2) {
            const candidate = line.slice(0, head) + ELLIPSIS + line.slice(line.length - tail);
            if (measure(candidate, size) <= maxWidth) return candidate;
            if (head > tail) head--; else tail--;
        }
        return ELLIPSIS;
    }
    let cut = line.length;
    while (cut > 0) {
        const candidate = line.slice(0, cut).trimEnd() + ELLIPSIS;
        if (measure(candidate, size) <= maxWidth) return candidate;
        cut--;
    }
    return ELLIPSIS;
}
