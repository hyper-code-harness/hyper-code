// One flag that turns an invisible layout bug into a visible outline.
//
// Satori has `debug: true`; TikZ's own manual draws its anchor diagrams this
// way. Every box is already on hand — grid returns cells, anchor returns
// points, layout returns boxes — so drawing them costs nothing and is the
// shortest path from "the picture looks wrong" to "that cell is 12px too
// narrow". Add it as the last child of the <svg>, read the drawing, delete the
// line.

type Box = { x: number; y: number; w?: number; h?: number; width?: number; height?: number };
type Grid = { x: number; y: number; width: number; height: number; colSizes: number[]; rowSizes: number[]; cell: (at: { col?: number; row?: number }) => { x: number; y: number; w: number; h: number } };

/**
 * Draws an overlay that makes layout visible: cell outlines, box edges, indices.
 *
 * Use while building a drawing, then delete the call. Pass a grid to outline
 * every track and number it, boxes to outline anything placed by hand, and
 * points to mark anchors with a cross. Each outline is dashed and semi
 * transparent so the drawing underneath stays readable, and labels show the
 * index and size of each cell, which is what answers "why is this column
 * narrow". Add the returned node last inside the <svg> so it sits on top.
 * @param opts.grid A grid from svg.grid; every cell is outlined and numbered.
 * @param opts.boxes Boxes to outline, with optional labels.
 * @param opts.points Points to mark with a cross, e.g. anchors.
 * @param opts.color Overlay colour. @default "#E05A5A"
 * @param opts.labels Draw indices and sizes next to each outline. @default true
 * @returns A single node holding the whole overlay.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** A grid from svg.grid; every cell is outlined and numbered. */
    grid?: Grid;
    /** Boxes to outline, with optional labels. */
    boxes?: Array<Box & { label?: string }>;
    /** Points to mark with a cross, e.g. anchors. */
    points?: Array<{ x: number; y: number; label?: string }>;
    /** Overlay colour. @default "#E05A5A" */
    color?: string;
    /** Draw indices and sizes next to each outline. @default true */
    labels?: boolean;
}): { node: types.svg.Node } {
    const color = opts.color ?? "#E05A5A";
    const withLabels = opts.labels !== false;
    const children: types.svg.Node[] = [];

    const outline = (x: number, y: number, w: number, h: number, dash: string, opacity: number) =>
        ctx.fns.svg.element({
            tag: "rect",
            props: { x, y, width: w, height: h, fill: "none", stroke: color, strokeWidth: 1, strokeDasharray: dash, opacity },
        });
    const tag = (text: string, x: number, y: number) =>
        ctx.fns.svg.label({ text, x, y, size: 7, fill: color, font: "ui-monospace, monospace" }).node;

    if (opts.grid) {
        const g = opts.grid;
        children.push(outline(g.x, g.y, g.width, g.height, "4 3", 0.9));
        for (let row = 0; row < g.rowSizes.length; row++) {
            for (let col = 0; col < g.colSizes.length; col++) {
                const c = g.cell({ col, row });
                children.push(outline(c.x, c.y, c.w, c.h, "2 2", 0.55));
                // The index first, because that is what a caller typed, then the
                // size, because that is what they got.
                if (withLabels) children.push(tag(`${col},${row} ${Math.round(c.w)}×${Math.round(c.h)}`, c.x + 2, c.y + 8));
            }
        }
    }

    for (const box of opts.boxes ?? []) {
        const w = Number(box.w ?? box.width ?? 0), h = Number(box.h ?? box.height ?? 0);
        children.push(outline(Number(box.x), Number(box.y), w, h, "3 2", 0.85));
        if (withLabels) children.push(tag(box.label ?? `${Math.round(w)}×${Math.round(h)}`, Number(box.x) + 2, Number(box.y) - 3));
    }

    for (const point of opts.points ?? []) {
        const x = Number(point.x), y = Number(point.y);
        children.push(ctx.fns.svg.element({ tag: "path", props: { d: `M ${x - 4} ${y} H ${x + 4} M ${x} ${y - 4} V ${y + 4}`, stroke: color, strokeWidth: 1, opacity: 0.9 } }));
        if (withLabels && point.label) children.push(tag(point.label, x + 6, y - 2));
    }

    return { node: ctx.fns.svg.element({ tag: "g", props: { "data-debug": "svg" }, children }) };
}
