/**
 * Scrolls an app window or one of its scrollable elements in the background, returning a fresh screenshot of the result.
 *
 * Direction up/down/left/right; amount counts wheel notches (line) or pages (page). Target a list or pane with element, text or x/y, otherwise the window content under its center is scrolled. Electron/Chromium windows (Discord, Slack) refuse background scrolling on macOS; then the scroll is retried with a brief foreground delivery unless foreground is false.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title when the app has several windows.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.element Element index from the latest desktop.look of this window.
 * @param opts.x Horizontal position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.y Vertical position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.text Visible label to target, resolved via Accessibility then OCR.
 * @param opts.direction Scroll direction.
 * @param opts.amount Number of notches or pages. @default 5 @minimum 1 @maximum 100
 * @param opts.foreground true = always briefly front the window; false = never, fail instead; omit = background, falling back to foreground when the app refuses. 
 * @param opts.by Granularity: line (wheel notches) or page. @default line
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
        /** Scroll direction. */
        direction: "up" | "down" | "left" | "right";
        /** Number of notches or pages. @default 5 @minimum 1 @maximum 100 */
        amount?: number;
        /** true = always briefly front the window; false = never, fail instead; omit = background, falling back to foreground when the app refuses. */
        foreground?: boolean;
        /** Granularity: line (wheel notches) or page. @default line */
        by?: "line" | "page";
        /** Look again after the action: none, tree, screenshot or both. @default screenshot */
        after?: "none" | "tree" | "screenshot" | "both";
        /** Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; target: types.desktop.AppWindow; via: "element" | "pixel" | "window"; element?: number; x?: number; y?: number; label?: string; summary: string; ms: number; look?: { title: string; outline: string; image?: string; elements: number } }> {
    let { x, y } = opts;
    if (opts.element === undefined && opts.text === undefined && (x === undefined || y === undefined)) {
        // Default to the window centre in screenshot pixels so the wheel lands on the main content.
        const l = await ctx.fns.desktop.look({ app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, tree: false });
        x = Math.round((l.width ?? 0) / 2); y = Math.round((l.height ?? 0) / 2);
    }
    const args: Record<string, unknown> = { direction: opts.direction, amount: opts.amount ?? 5, ...(opts.by ? { by: opts.by } : {}), ...(opts.foreground ? { delivery_mode: "foreground" } : {}) };
    const run = (a: Record<string, unknown>) => ctx.fns.desktop.act({ tool: "scroll", args: a, app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, element: opts.element, x, y, text: opts.text, after: opts.after ?? "screenshot", waitMs: opts.waitMs });
    try {
        return await run(args);
    } catch (e) {
        if (opts.foreground !== undefined || !/background scroll is unavailable/i.test(String(e))) throw e;
        return await run({ ...args, delivery_mode: "foreground" });
    }
}
