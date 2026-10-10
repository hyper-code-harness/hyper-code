// What the drawing actually covers — the check that replaces squinting at a
// preview.
//
// A drawing is written blind: nothing says a caption ran past the right edge
// until a human sees the clipped picture. The viewBox is the contract, so
// compare the contract with the geometry. Every coordinate in the markup is
// scanned and reduced to one rectangle; if that rectangle sticks out of the
// viewBox, the drawing is clipped and the numbers say by how much.
//
// Honest limits, because a wrong "all clear" is worse than no check:
//   * transform= is ignored — a translated group is measured where its own
//     coordinates say, not where it lands.
//   * text is measured from its anchor with svg.measureText, an estimate.
//   * stroke width, markers and filters add ink outside the geometry.
// So treat a small overflow as a warning and a large one as a fact.

/** Pull every number out of a path's `d` and read them as alternating x/y. */
function pathPoints(d: string): Array<[number, number]> {
    // Reading a path as a flat list of x/y pairs is wrong twice over: a relative
    // command (l, c, m…) carries offsets, not positions, and H/V carry a single
    // coordinate. Both shift every later pair by one and invent points far
    // outside the drawing — a false "it does not fit", which is worse than no
    // check at all. So walk the commands and keep a pen position.
    const points: Array<[number, number]> = [];
    let x = 0, y = 0, startX = 0, startY = 0;
    for (const [, letter, rest] of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
        const n = (rest!.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
        const cmd = letter!, rel = cmd === cmd.toLowerCase();
        const up = cmd.toUpperCase();
        // Arcs put flags and radii before the endpoint, so only the last pair of
        // each 7-number group is a coordinate.
        const stride = up === "A" ? 7 : up === "C" ? 6 : up === "S" || up === "Q" ? 4 : up === "H" || up === "V" ? 1 : 2;
        if (up === "Z") { x = startX; y = startY; points.push([x, y]); continue; }
        for (let i = 0; i + stride <= n.length; i += stride) {
            if (up === "H") { x = rel ? x + n[i]! : n[i]!; }
            else if (up === "V") { y = rel ? y + n[i]! : n[i]!; }
            else {
                // Control points count too: a curve can bulge past its endpoints,
                // and over-reporting the bounds is the safe direction to be wrong.
                for (let k = 0; k + 1 < stride; k += 2) {
                    const px = rel ? x + n[i + k]! : n[i + k]!;
                    const py = rel ? y + n[i + k + 1]! : n[i + k + 1]!;
                    points.push([px, py]);
                    if (k + 2 >= stride) { x = px; y = py; }
                }
            }
            if (up === "H" || up === "V") points.push([x, y]);
            if (up === "M" && i === 0) { startX = x; startY = y; }
        }
    }
    return points;
}

/**
 * Measures what a drawing covers and reports whether it overflows its viewBox.
 *
 * Use after building an SVG and before showing it: it answers "does everything
 * fit" without rendering the picture. Rectangles, circles, ellipses, lines,
 * polygons, paths and text are scanned, and the union of their coordinates is
 * returned; when the root has a viewBox, `overflow` names the sides that are
 * exceeded and `fits` is false. Known approximations: transform attributes are
 * ignored, text width is estimated, and stroke width is not counted — so a
 * one-pixel overflow is noise and a twenty-pixel one is real. `suggestedViewBox`
 * is the box that would hold the drawing with the given padding.
 * @param opts.svg SVG markup to measure.
 * @param opts.padding Padding to leave around the content in suggestedViewBox. @default 8
 * @returns The content bounds, the declared viewBox, overflow per side, and a viewBox that would fit.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** SVG markup to measure. */
    svg: string;
    /** Padding to leave around the content in suggestedViewBox. @default 8 */
    padding?: number;
}): {
    content: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null;
    viewBox: { minX: number; minY: number; width: number; height: number } | null;
    fits: boolean;
    overflow: { left: number; right: number; top: number; bottom: number };
    suggestedViewBox: string | null;
} {
    const svg = String(opts.svg ?? "");
    const pad = Number(opts.padding ?? 8);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x: number, y: number) => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    };

    const body = svg.slice(svg.indexOf(">") + 1);
    // A <tspan> carries almost nothing of its own: size and anchor come from the
    // enclosing <text>, and a wrapped line gives only `dy`, an offset from the
    // previous baseline. So the open <text> is remembered and its baseline walks
    // down line by line — without this every wrapped label is measured at y=0,
    // which reads as a huge overflow off the top of the drawing.
    let open: { size: number; anchor?: string; y: number } | null = null;
    for (const match of body.matchAll(/<([a-zA-Z]+)\b([^>]*)>([^<]*)/g)) {
        const tag = match[1]!.toLowerCase();
        const attrs = match[2]!;
        const text = match[3] ?? "";
        const num = (name: string) => {
            const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs);
            return m ? Number.parseFloat(m[1]!) : NaN;
        };
        if (tag === "rect") { const x = num("x") || 0, y = num("y") || 0; add(x, y); add(x + (num("width") || 0), y + (num("height") || 0)); }
        else if (tag === "circle") { const r = num("r") || 0, cx = num("cx") || 0, cy = num("cy") || 0; add(cx - r, cy - r); add(cx + r, cy + r); }
        else if (tag === "ellipse") { const cx = num("cx") || 0, cy = num("cy") || 0; add(cx - (num("rx") || 0), cy - (num("ry") || 0)); add(cx + (num("rx") || 0), cy + (num("ry") || 0)); }
        else if (tag === "line") { add(num("x1") || 0, num("y1") || 0); add(num("x2") || 0, num("y2") || 0); }
        else if (tag === "polygon" || tag === "polyline") {
            const points = (/\bpoints\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? "").match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
            for (let i = 0; i + 1 < points.length; i += 2) add(points[i]!, points[i + 1]!);
        }
        else if (tag === "path") { for (const [x, y] of pathPoints(/\bd\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? "")) add(x, y); }
        else if (tag === "text" || tag === "tspan") {
            const size = Number.isFinite(num("font-size")) ? num("font-size") : (tag === "tspan" ? open?.size ?? 12 : 12);
            const anchor = /\btext-anchor\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? (tag === "tspan" ? open?.anchor : undefined);
            const dy = num("dy"), own = num("y");
            const y = (Number.isFinite(own) ? own : open?.y ?? 0) + (Number.isFinite(dy) ? dy : 0);
            if (tag === "text") open = { size, anchor, y };
            else if (open) open.y = y;

            const content = text.trim();
            if (content) {
                const x = num("x") || 0;
                const w = ctx.fns.svg.measureText({ text: content, size }).width;
                const left = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
                // y is the baseline: ascent above it, descent below.
                add(left, y - size * 0.8);
                add(left + w, y + size * 0.25);
            }
        }
    }

    const content = Number.isFinite(minX)
        ? { minX, minY, maxX, maxY, width: Math.round((maxX - minX) * 100) / 100, height: Math.round((maxY - minY) * 100) / 100 }
        : null;

    const head = svg.slice(0, svg.indexOf(">") + 1);
    const vb = (/\bviewBox\s*=\s*"([^"]*)"/i.exec(head)?.[1] ?? "").trim().split(/[\s,]+/).map(Number);
    const viewBox = vb.length === 4 && vb.every(Number.isFinite) ? { minX: vb[0]!, minY: vb[1]!, width: vb[2]!, height: vb[3]! } : null;

    const over = { left: 0, right: 0, top: 0, bottom: 0 };
    if (content && viewBox) {
        over.left = Math.max(0, Math.round((viewBox.minX - content.minX) * 100) / 100);
        over.top = Math.max(0, Math.round((viewBox.minY - content.minY) * 100) / 100);
        over.right = Math.max(0, Math.round((content.maxX - (viewBox.minX + viewBox.width)) * 100) / 100);
        over.bottom = Math.max(0, Math.round((content.maxY - (viewBox.minY + viewBox.height)) * 100) / 100);
    }

    return {
        content,
        viewBox,
        fits: !content || !viewBox || (over.left + over.right + over.top + over.bottom) === 0,
        overflow: over,
        suggestedViewBox: content
            ? `${Math.round((content.minX - pad) * 10) / 10} ${Math.round((content.minY - pad) * 10) / 10} ${Math.round((content.width + pad * 2) * 10) / 10} ${Math.round((content.height + pad * 2) * 10) / 10}`
            : null,
    };
}
