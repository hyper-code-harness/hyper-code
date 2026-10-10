// An arrow from one box to another, without defs, markers or trigonometry.
//
// Two things make connectors tedious by hand. First the endpoints: an arrow
// should stop at the edge of a box, not at its centre, so every connector needs
// the intersection of a line with a rectangle. Second the head: the usual way
// is <defs><marker> with an id, and ids collide the moment a drawing is built
// from a loop. So the edge intersection is computed here and the head is drawn
// as an ordinary polygon — self-contained, no shared state.

type Box = { x: number; y: number; w: number; h: number };

/** Where a ray from the centre of a box towards (tx, ty) leaves the box. */
function edgePoint(box: Box, tx: number, ty: number, pad: number): { x: number; y: number } {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    // Scale the direction until it touches the nearer pair of sides.
    const sx = dx === 0 ? Infinity : (box.w / 2 + pad) / Math.abs(dx);
    const sy = dy === 0 ? Infinity : (box.h / 2 + pad) / Math.abs(dy);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
}

/**
 * Draws an arrow between two boxes, clipped to their edges, with an arrowhead.
 *
 * Use for any connector in a hand-placed diagram: the line starts and ends on
 * the box borders rather than their centres, so boxes can be moved without
 * redoing the geometry, and boxes from svg.layout can be passed straight in.
 * `style` picks the shape — a straight line, an orthogonal elbow for
 * block diagrams, or a curve for a softer graph; `gap` keeps the tip off the
 * border. The arrowhead is a plain polygon, not a marker definition, so many
 * connectors in one drawing never collide. An optional label is centred on the
 * line with a small background plate so it stays readable over other shapes.
 * @param opts.from Source box: x, y, w, h.
 * @param opts.to Target box: x, y, w, h.
 * @param opts.style Line shape: straight, orthogonal elbow, or curve. @default "straight"
 * @param opts.color Stroke colour of the line and head. @default "#9aa3b2"
 * @param opts.width Stroke width in pixels. @default 1.2 @minimum 0.1
 * @param opts.dashed Draws the line dashed, for a weaker relation. @default false
 * @param opts.head Which ends get an arrowhead. @default "end"
 * @param opts.headSize Length of the arrowhead in pixels. @default 7 @minimum 1
 * @param opts.gap Space left between the box border and the arrow tip. @default 2
 * @param opts.label Text drawn at the middle of the connector.
 * @param opts.labelSize Font size of the label in pixels. @default 9 @minimum 1
 * @param opts.labelBackground Colour of the plate behind the label; "none" for no plate. @default "#fff"
 * @returns The connector node plus its endpoints and midpoint, for placing anything else.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Source box: x, y, w, h. */
    from: Box;
    /** Target box: x, y, w, h. */
    to: Box;
    /** Line shape: straight, orthogonal elbow, or curve. @default "straight" */
    style?: "straight" | "orthogonal" | "curve";
    /** Stroke colour of the line and head. @default "#9aa3b2" */
    color?: string;
    /** Stroke width in pixels. @default 1.2 @minimum 0.1 */
    width?: number;
    /** Draws the line dashed, for a weaker relation. @default false */
    dashed?: boolean;
    /** Which ends get an arrowhead. @default "end" */
    head?: "end" | "both" | "none";
    /** Length of the arrowhead in pixels. @default 7 @minimum 1 */
    headSize?: number;
    /** Space left between the box border and the arrow tip. @default 2 */
    gap?: number;
    /** Text drawn at the middle of the connector. */
    label?: string;
    /** Font size of the label in pixels. @default 9 @minimum 1 */
    labelSize?: number;
    /** Colour of the plate behind the label; "none" for no plate. @default "#fff" */
    labelBackground?: string;
}): { node: types.svg.Node; start: { x: number; y: number }; end: { x: number; y: number }; mid: { x: number; y: number } } {
    const el = (tag: string, props: Record<string, unknown>, children: unknown[] = []) => ctx.fns.svg.element({ tag, props, children });
    const from = opts.from, to = opts.to;
    const gap = Number(opts.gap ?? 2);
    const color = opts.color ?? "#9aa3b2";
    const strokeWidth = Number(opts.width ?? 1.2);
    const headSize = Number(opts.headSize ?? 7);
    const style = opts.style ?? "straight";

    const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
    const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
    const start = edgePoint(from, tc.x, tc.y, gap);
    const end = edgePoint(to, fc.x, fc.y, gap);

    // The elbow turns along the axis with more distance to cover, which is the
    // turn a person would draw.
    const horizontalFirst = Math.abs(tc.x - fc.x) >= Math.abs(tc.y - fc.y);
    const elbow = horizontalFirst ? { x: (start.x + end.x) / 2, y: start.y } : { x: start.x, y: (start.y + end.y) / 2 };
    const elbow2 = horizontalFirst ? { x: (start.x + end.x) / 2, y: end.y } : { x: end.x, y: (start.y + end.y) / 2 };

    const d = style === "orthogonal"
        ? `M ${start.x} ${start.y} L ${elbow.x} ${elbow.y} L ${elbow2.x} ${elbow2.y} L ${end.x} ${end.y}`
        : style === "curve"
            ? `M ${start.x} ${start.y} C ${horizontalFirst ? `${(start.x + end.x) / 2} ${start.y} ${(start.x + end.x) / 2} ${end.y}` : `${start.x} ${(start.y + end.y) / 2} ${end.x} ${(start.y + end.y) / 2}`} ${end.x} ${end.y}`
            : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

    // The head points along the last segment, which for an elbow is not the
    // overall direction of the connector.
    const tail = style === "orthogonal" ? elbow2 : start;
    const arrow = (tip: { x: number; y: number }, back: { x: number; y: number }) => {
        const angle = Math.atan2(tip.y - back.y, tip.x - back.x);
        const spread = 0.42;
        const p = (sign: number) => `${(tip.x - headSize * Math.cos(angle + sign * spread)).toFixed(2)},${(tip.y - headSize * Math.sin(angle + sign * spread)).toFixed(2)}`;
        return el("polygon", { points: `${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${p(1)} ${p(-1)}`, fill: color });
    };

    const children: unknown[] = [
        el("path", { d, fill: "none", stroke: color, strokeWidth, strokeDasharray: opts.dashed ? "4 3" : null, strokeLinejoin: "round" }),
    ];
    const head = opts.head ?? "end";
    if (head !== "none") children.push(arrow(end, tail));
    if (head === "both") children.push(arrow(start, style === "orthogonal" ? elbow : end));

    const mid = style === "orthogonal"
        ? { x: (elbow.x + elbow2.x) / 2, y: (elbow.y + elbow2.y) / 2 }
        : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

    if (opts.label) {
        const size = Number(opts.labelSize ?? 9);
        const w = ctx.fns.svg.measureText({ text: opts.label, size }).width;
        const plate = opts.labelBackground ?? "#fff";
        if (plate !== "none") children.push(el("rect", { x: mid.x - w / 2 - 3, y: mid.y - size / 2 - 2, width: w + 6, height: size + 4, rx: 3, fill: plate }));
        children.push(ctx.fns.svg.label({ text: opts.label, x: mid.x, y: mid.y + size / 3, size, anchor: "middle", fill: color }).node);
    }

    return { node: el("g", {}, children), start, end, mid };
}
