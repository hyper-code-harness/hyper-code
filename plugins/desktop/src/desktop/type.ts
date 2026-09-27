/**
 * Types Unicode text into an app window — into a given field, a labelled field, a pixel point, or the currently focused element — in the background.
 *
 * Cua Driver inserts the text through Accessibility when the target supports it and falls back to per-character keyboard events; works with any layout, Cyrillic and emoji. Pass element/text/x+y to focus the field first. Does not press Return — follow with desktop.key({ key: "return" }) to submit. For replacing a whole field value prefer desktop.setValue.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title when the app has several windows.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.element Element index from the latest desktop.look of this window.
 * @param opts.x Horizontal position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.y Vertical position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.text Visible label to target, resolved via Accessibility then OCR.
 * @param opts.value Text to type.
 * @param opts.delayMs Milliseconds between characters on the keyboard-event fallback path. @default 30 @minimum 0 @maximum 1000
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
        /** Text to type. */
        value: string;
        /** Milliseconds between characters on the keyboard-event fallback path. @default 30 @minimum 0 @maximum 1000 */
        delayMs?: number;
        /** Look again after the action: none, tree, screenshot or both. @default screenshot */
        after?: "none" | "tree" | "screenshot" | "both";
        /** Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; target: types.desktop.AppWindow; via: "element" | "pixel" | "window"; element?: number; x?: number; y?: number; label?: string; summary: string; ms: number; look?: { title: string; outline: string; image?: string; elements: number } }> {
    const args: Record<string, unknown> = { text: opts.value };
    if (opts.delayMs !== undefined) args.delay_ms = opts.delayMs;
    return await ctx.fns.desktop.act({ tool: "type_text", args, app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, element: opts.element, x: opts.x, y: opts.y, text: opts.text, after: opts.after ?? "none", waitMs: opts.waitMs });
}
