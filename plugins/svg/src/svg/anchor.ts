// "Under the left edge of that box, eight pixels down."
//
// The second repeated pain after text width. Attaching a caption, a badge or a
// second box to an existing one is always the same four lines of arithmetic,
// and the arithmetic is where a sign flips. TikZ solved this with named anchors
// — `below=8pt of A.west` — and the idea carries over unchanged: name the point
// on the box, say which way to go, and get a point back.

/** The nine points of a box, plus the four edge midpoints by compass name. */
const POINTS: Record<string, (b: Box) => { x: number; y: number }> = {
    "top-left": b => ({ x: b.x, y: b.y }),
    "top": b => ({ x: b.x + b.w / 2, y: b.y }),
    "top-right": b => ({ x: b.x + b.w, y: b.y }),
    "left": b => ({ x: b.x, y: b.y + b.h / 2 }),
    "center": b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }),
    "right": b => ({ x: b.x + b.w, y: b.y + b.h / 2 }),
    "bottom-left": b => ({ x: b.x, y: b.y + b.h }),
    "bottom": b => ({ x: b.x + b.w / 2, y: b.y + b.h }),
    "bottom-right": b => ({ x: b.x + b.w, y: b.y + b.h }),
};

type Box = { x: number; y: number; w: number; h: number };
type Where = "above" | "below" | "left-of" | "right-of" | "inside";

/**
 * Finds a point or places a box relative to an existing one, by name.
 *
 * Use instead of writing offsets by hand: `anchor({ of: card, at: "bottom-left",
 * place: "below", gap: 8 })` is the caption under a card, and it stays correct
 * when the card moves. `at` names one of the nine points of the box
 * (top-left … bottom-right, plus the edge midpoints); `place` pushes away from
 * that edge by `gap`, while "inside" keeps the point on the box and is how a
 * label is put in a corner with padding. Giving `size` returns a whole box
 * placed there — aligned so it does not overlap the source — which is enough to
 * chain boxes without a layout pass. Both the point and the box come back, so
 * the same call serves text and shapes.
 * @param opts.of The box to attach to: x, y, w, h.
 * @param opts.at Which point of the box to start from. @default "center"
 * @param opts.place Direction to move away from that point; "inside" stays on the box. @default "inside"
 * @param opts.gap Distance to move in that direction, in pixels. @default 0
 * @param opts.size Size of the box being placed; omit to get only a point.
 * @param opts.align Cross-axis alignment of the placed box against the source. @default "start"
 * @returns The anchor point, and the placed box when a size was given.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** The box to attach to: x, y, w, h. */
    of: Box;
    /** Which point of the box to start from. @default "center" */
    at?: "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";
    /** Direction to move away from that point; "inside" stays on the box. @default "inside" */
    place?: Where;
    /** Distance to move in that direction, in pixels. @default 0 */
    gap?: number;
    /** Size of the box being placed; omit to get only a point. */
    size?: { w: number; h: number };
    /** Cross-axis alignment of the placed box against the source. @default "start" */
    align?: "start" | "center" | "end";
}): { x: number; y: number; box: { x: number; y: number; w: number; h: number; width: number; height: number; cx: number; cy: number; right: number; bottom: number } | null } {
    const of = opts.of;
    const at = opts.at ?? "center";
    const place = opts.place ?? "inside";
    const gap = Number(opts.gap ?? 0);
    const point = (POINTS[at] ?? POINTS["center"]!)(of);

    // "inside" pushes towards the middle, so a gap reads as padding rather than
    // as an escape from the box — a corner label wants exactly that.
    const inward = at.includes("left") ? 1 : at.includes("right") ? -1 : 0;
    const inwardY = at.includes("top") ? 1 : at.includes("bottom") ? -1 : 0;

    const moved = place === "above" ? { x: point.x, y: point.y - gap }
        : place === "below" ? { x: point.x, y: point.y + gap }
            : place === "left-of" ? { x: point.x - gap, y: point.y }
                : place === "right-of" ? { x: point.x + gap, y: point.y }
                    : { x: point.x + inward * gap, y: point.y + inwardY * gap };

    if (!opts.size) return { x: moved.x, y: moved.y, box: null };

    const w = Number(opts.size.w), h = Number(opts.size.h);
    const align = opts.align ?? "start";
    // The placed box hangs off the anchor in the direction of travel, so it
    // never covers the box it was attached to.
    const lead = (span: number) => (align === "center" ? -span / 2 : align === "end" ? -span : 0);
    const x = place === "left-of" ? moved.x - w
        : place === "right-of" ? moved.x
            : moved.x + (at.includes("right") ? -w : at === "top" || at === "bottom" || at === "center" ? lead(w) : 0);
    const y = place === "above" ? moved.y - h
        : place === "below" ? moved.y
            : moved.y + (at.includes("bottom") ? -h : at === "left" || at === "right" || at === "center" ? lead(h) : 0);

    // Both spellings of the size, so the box spreads straight onto a <rect>.
    return { x: moved.x, y: moved.y, box: { x, y, w, h, width: w, height: h, cx: x + w / 2, cy: y + h / 2, right: x + w, bottom: y + h } };
}
