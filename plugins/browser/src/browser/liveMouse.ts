// A viewer pointer event → Input.dispatchMouseEvent parameters, in the page's
// CSS pixels. The viewer already did the scaling from its canvas to the frame's
// device size (frame metadata), so this only validates and names things.

const BUTTONS = ["left", "middle", "right", "back", "forward"] as const;

/**
 * Converts one live-view pointer or wheel event into Chrome DevTools `Input.dispatchMouseEvent` parameters.
 *
 * Every move is meant to be forwarded one-to-one (no throttling) so the page sees the human's real
 * trajectory; `buttons` keeps the held-button mask on moves so drags work. Wheel deltas are passed in
 * CSS pixels. Returns null for malformed coordinates.
 * @param opts.type Viewer event: `move`, `down`, `up` or `wheel`.
 * @param opts.x Horizontal position in page CSS pixels.
 * @param opts.y Vertical position in page CSS pixels.
 * @param opts.button DOM MouseEvent.button: 0 left, 1 middle, 2 right, 3 back, 4 forward. @default 0
 * @param opts.buttons DOM MouseEvent.buttons mask of held buttons. @default 0
 * @param opts.clickCount Click count for down/up (MouseEvent.detail). @default 1
 * @param opts.modifiers CDP modifier mask: Alt=1, Ctrl=2, Meta=4, Shift=8. @default 0
 * @param opts.deltaX Horizontal wheel delta in CSS pixels. @default 0
 * @param opts.deltaY Vertical wheel delta in CSS pixels. @default 0
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Viewer event: `move`, `down`, `up` or `wheel`. */
        type: "move" | "down" | "up" | "wheel";
        /** Horizontal position in page CSS pixels. */
        x: number;
        /** Vertical position in page CSS pixels. */
        y: number;
        /** DOM MouseEvent.button: 0 left, 1 middle, 2 right, 3 back, 4 forward. @default 0 */
        button?: number;
        /** DOM MouseEvent.buttons mask of held buttons. @default 0 */
        buttons?: number;
        /** Click count for down/up (MouseEvent.detail). @default 1 */
        clickCount?: number;
        /** CDP modifier mask: Alt=1, Ctrl=2, Meta=4, Shift=8. @default 0 */
        modifiers?: number;
        /** Horizontal wheel delta in CSS pixels. @default 0 */
        deltaX?: number;
        /** Vertical wheel delta in CSS pixels. @default 0 */
        deltaY?: number;
    },
): Record<string, unknown> | null {
    const x = Number(opts.x), y = Number(opts.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const common = { x, y, modifiers: (opts.modifiers ?? 0) & 15, buttons: (opts.buttons ?? 0) & 31 };
    if (opts.type === "wheel") {
        return { type: "mouseWheel", ...common, button: "none", deltaX: Number(opts.deltaX) || 0, deltaY: Number(opts.deltaY) || 0 };
    }
    if (opts.type === "move") {
        // CDP reports the "pressed" button on a move from the held mask, which is what makes drags drag.
        const held = BUTTONS.find((_, i) => (common.buttons & [1, 4, 2, 8, 16][i]!) !== 0) ?? "none";
        return { type: "mouseMoved", ...common, button: held };
    }
    const button = BUTTONS[opts.button ?? 0] ?? "left";
    return {
        type: opts.type === "down" ? "mousePressed" : "mouseReleased",
        ...common, button, clickCount: Math.max(1, Math.min(3, opts.clickCount ?? 1)),
    };
}
