// Text that wraps, because <text> does not.
//
// SVG draws a string on one infinite line. Wrapping means splitting the string
// yourself and emitting one <tspan> per line with an explicit dy — so this does
// that, using svg.measureText to decide where to break, and returns a Node that
// drops straight into JSX.

/**
 * Draws a text label, wrapped to a maximum width, as a ready SVG node.
 *
 * Use wherever a caption may be longer than the space it has: a box label, an
 * annotation, a legend entry. Lines are broken on spaces (a single word longer
 * than maxWidth is left whole rather than cut), measured with svg.measureText,
 * and emitted as tspans under one <text>, so anchor and fill apply to all of
 * them. Without maxWidth it is a plain one-line label. `y` is the baseline of
 * the first line; the returned node can be used directly as a JSX child.
 * @param opts.text The label; a newline in it forces a line break.
 * @param opts.x Baseline x of the text, meaning depends on anchor.
 * @param opts.y Baseline y of the first line.
 * @param opts.maxWidth Wrap to this width in pixels; omitted means no wrapping. @minimum 8
 * @param opts.size Font size in pixels. @default 12 @minimum 1
 * @param opts.fill Text colour, any CSS colour. @default "#333"
 * @param opts.weight Font weight. @default 400
 * @param opts.anchor Horizontal alignment relative to x. @default "start"
 * @param opts.lineHeight Line spacing as a multiple of the font size. @default 1.3
 * @param opts.font Font family for the text element. @default "Inter, system-ui, sans-serif"
 * @param opts.opacity Opacity of the whole label, 0 to 1. @maximum 1
 * @returns The text node and the box it occupies, so neighbours can be placed around it.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The label; a newline in it forces a line break. */
    text: string;
    /** Baseline x of the text, meaning depends on anchor. */
    x: number;
    /** Baseline y of the first line. */
    y: number;
    /** Wrap to this width in pixels; omitted means no wrapping. @minimum 8 */
    maxWidth?: number;
    /** Font size in pixels. @default 12 @minimum 1 */
    size?: number;
    /** Text colour, any CSS colour. @default "#333" */
    fill?: string;
    /** Font weight. @default 400 */
    weight?: number;
    /** Horizontal alignment relative to x. @default "start" */
    anchor?: "start" | "middle" | "end";
    /** Line spacing as a multiple of the font size. @default 1.3 */
    lineHeight?: number;
    /** Font family for the text element. @default "Inter, system-ui, sans-serif" */
    font?: string;
    /** Opacity of the whole label, 0 to 1. @maximum 1 */
    opacity?: number;
}): { node: types.svg.Node; lines: string[]; width: number; height: number } {
    const size = Number(opts.size ?? 12);
    const weight = Number(opts.weight ?? 400);
    const step = size * Number(opts.lineHeight ?? 1.3);
    const measure = (s: string) => ctx.fns.svg.measureText({ text: s, size, weight }).width;

    const lines: string[] = [];
    for (const paragraph of String(opts.text ?? "").split("\n")) {
        if (!opts.maxWidth) { lines.push(paragraph); continue; }
        let current = "";
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const candidate = current ? `${current} ${word}` : word;
            // A word that does not fit on its own still gets its own line —
            // breaking inside a word reads worse than one overhanging label.
            if (current && measure(candidate) > opts.maxWidth) { lines.push(current); current = word; }
            else current = candidate;
        }
        lines.push(current);
    }

    const width = Math.max(0, ...lines.map(measure));
    const children = lines.map((line, i) => ctx.fns.svg.element({
        tag: "tspan",
        // x must be repeated on every tspan, otherwise lines after the first
        // continue where the previous one ended instead of starting over.
        props: { x: opts.x, dy: i === 0 ? 0 : step },
        children: [line],
    }));

    const node = ctx.fns.svg.element({
        tag: "text",
        props: {
            x: opts.x, y: opts.y,
            fontSize: size, fontFamily: opts.font ?? "Inter, system-ui, sans-serif",
            fontWeight: weight === 400 ? null : weight,
            fill: opts.fill ?? "#333",
            textAnchor: opts.anchor && opts.anchor !== "start" ? opts.anchor : null,
            opacity: opts.opacity ?? null,
        },
        children,
    });

    return { node, lines, width: Math.round(width * 100) / 100, height: Math.round((step * (lines.length - 1) + size) * 100) / 100 };
}
