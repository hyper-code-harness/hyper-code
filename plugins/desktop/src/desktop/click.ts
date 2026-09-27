/**
 * Clicks with the real mouse at screen coordinates or at the center of a UI element from desktop.snapshot.
 *
 * Use when desktop.press is not supported (web content, canvas, custom controls) or when a position comes from desktop.screenshot/OCR. Coordinates are screen points with a top-left origin (screenshot pixels divided by the screen scale). Moves the user's pointer and sends the click to whatever window is under it, so activate the target app first. Requires Accessibility permission.
 * @param opts.id Element id from desktop.snapshot; its frame center is clicked. Either id or x/y is required.
 * @param opts.app Application for id resolution; omit for the frontmost application.
 * @param opts.x Horizontal screen coordinate in points.
 * @param opts.y Vertical screen coordinate in points.
 * @param opts.button Mouse button. @default left
 * @param opts.count Number of clicks; 2 is a double-click. @default 1 @minimum 1 @maximum 3
 * @param opts.waitMs Pause after the click so the UI settles. @default 300 @minimum 0 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Element id from desktop.snapshot; its frame center is clicked. Either id or x/y is required. */
        id?: string;
        /** Application for id resolution; omit for the frontmost application. */
        app?: string;
        /** Horizontal screen coordinate in points. */
        x?: number;
        /** Vertical screen coordinate in points. */
        y?: number;
        /** Mouse button. @default left */
        button?: "left" | "right";
        /** Number of clicks; 2 is a double-click. @default 1 @minimum 1 @maximum 3 */
        count?: number;
        /** Pause after the click so the UI settles. @default 300 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; x: number; y: number }> {
    let x = opts.x, y = opts.y;
    if (opts.id) {
        const r = await ctx.fns.desktop.helper({ args: ["tree", opts.app ?? "", opts.id, "0", "1"] }) as { tree: types.desktop.UiNode };
        const f = r.tree.frame;
        if (!f) throw new Error(`desktop.click: element ${opts.id} has no frame`);
        x = f.x + f.w / 2; y = f.y + f.h / 2;
    }
    if (x === undefined || y === undefined) throw new Error("desktop.click: pass id or both x and y");
    await ctx.fns.desktop.helper({ args: ["click", String(x), String(y), opts.button ?? "left", String(opts.count ?? 1)] });
    await Bun.sleep(opts.waitMs ?? 300);
    return { ok: true, x, y };
}
