/**
 * Clicks a UI element, a screenshot pixel point or a visible text label in an app window, in the background without moving the user's pointer, and returns a fresh screenshot.
 *
 * Addressing: element (index from desktop.look, most reliable), text (label resolved via Accessibility, then OCR — convenient for Electron apps such as Discord or Slack), or x/y in the window screenshot pixels. Cua Driver presses the element through Accessibility when possible and otherwise posts mouse events to the target window. Set button right for context menus and count 2 for double-click. If the app ignores background clicks, pass foreground true.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title when the app has several windows.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.element Element index from the latest desktop.look of this window.
 * @param opts.x Horizontal position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.y Vertical position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.text Visible label to target, resolved via Accessibility then OCR.
 * @param opts.button Mouse button. @default left
 * @param opts.count Number of clicks; 2 is a double-click (pixel path). @default 1 @minimum 1 @maximum 3
 * @param opts.modifier Modifier keys held during the click, e.g. ["cmd"]; requires foreground on macOS.
 * @param opts.foreground Briefly bring the window to front for the click, then restore the previous app. @default false
 * @param opts.after Look again after the action: none, tree, screenshot or both. @default screenshot
 * @param opts.waitMs Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Case-insensitive substring of the window title when the app has several windows. */
        window?: string;
        /** Exact CGWindowID from a previous desktop result; wins over window. */
        windowId?: number;
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Element index from the latest desktop.look of this window. */
        element?: number;
        /** Horizontal position in window screenshot pixels from desktop.look (or its ocr lines). */
        x?: number;
        /** Vertical position in window screenshot pixels from desktop.look (or its ocr lines). */
        y?: number;
        /** Visible label to target, resolved via Accessibility then OCR. */
        text?: string;
        /** Mouse button. @default left */
        button?: "left" | "right" | "middle";
        /** Number of clicks; 2 is a double-click (pixel path). @default 1 @minimum 1 @maximum 3 */
        count?: number;
        /** Modifier keys held during the click, e.g. ["cmd"]; requires foreground on macOS. */
        modifier?: Array<"cmd" | "shift" | "option" | "ctrl">;
        /** Briefly bring the window to front for the click, then restore the previous app. @default false */
        foreground?: boolean;
        /** Look again after the action: none, tree, screenshot or both. @default screenshot */
        after?: "none" | "tree" | "screenshot" | "both";
        /** Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; target: types.desktop.AppWindow; via: "element" | "pixel" | "window"; element?: number; x?: number; y?: number; label?: string; summary: string; ms: number; look?: { title: string; outline: string; image?: string; elements: number } }> {
    if (opts.element === undefined && opts.text === undefined && (opts.x === undefined || opts.y === undefined)) throw new Error("desktop.click: pass element, text, or x and y");
    const args: Record<string, unknown> = {};
    if (opts.button && opts.button !== "left") args.button = opts.button;
    if (opts.count && opts.count > 1) args.count = opts.count;
    if (opts.modifier?.length) args.modifier = opts.modifier;
    if (opts.foreground || opts.modifier?.length) args.delivery_mode = "foreground";
    return await ctx.fns.desktop.act({ tool: "click", args, app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, element: opts.element, x: opts.x, y: opts.y, text: opts.text, after: opts.after ?? "screenshot", waitMs: opts.waitMs });
}
