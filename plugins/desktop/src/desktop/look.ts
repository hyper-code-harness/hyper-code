/**
 * Observes one app window: returns its Accessibility element outline with clickable indexes and a screenshot, optionally with OCR text boxes.
 *
 * The "look" step of the look → act → look loop. The outline lists actionable elements as `[index] Role "label" = value [actions]`; pass an index as element to desktop.click, desktop.type, desktop.setValue, desktop.key or desktop.scroll. The screenshot (read the returned image path to see it) is in window-local pixels; x/y read from it or from ocr lines are accepted by the same actions. Electron, canvas and web-heavy apps (Discord, Slack, Figma) expose little in the outline, so use ocr true and pixel coordinates there. Each look replaces the previous element indexes of that window. Works on background and covered windows without stealing focus.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title when the app has several windows.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.query Only keep outline rows matching this case-insensitive text (plus their ancestors); indexes stay valid.
 * @param opts.tree Walk the Accessibility tree. @default true
 * @param opts.screenshot Capture a screenshot of the window. @default true
 * @param opts.ocr Recognize text on the screenshot with Apple Vision and return lines with centers in screenshot pixels. @default false
 * @param opts.maxElements Cap on Accessibility nodes walked. @default 800 @minimum 10 @maximum 5000
 * @param opts.maxChars Truncate the outline text to this many characters. @default 8000 @minimum 200 @maximum 100000
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
        /** Only keep outline rows matching this case-insensitive text (plus their ancestors); indexes stay valid. */
        query?: string;
        /** Walk the Accessibility tree. @default true */
        tree?: boolean;
        /** Capture a screenshot of the window. @default true */
        screenshot?: boolean;
        /** Recognize text on the screenshot with Apple Vision and return lines with centers in screenshot pixels. @default false */
        ocr?: boolean;
        /** Cap on Accessibility nodes walked. @default 800 @minimum 10 @maximum 5000 */
        maxElements?: number;
        /** Truncate the outline text to this many characters. @default 8000 @minimum 200 @maximum 100000 */
        maxChars?: number;
    },
): Promise<{
    target: types.desktop.AppWindow;
    title: string;
    snapshotId?: string;
    elements: number;
    outline: string;
    image?: string;
    width?: number;
    height?: number;
    scale?: number;
    ocr?: Array<{ text: string; x: number; y: number; w: number; h: number; confidence: number }>;
    ms: number;
}> {
    const started = performance.now();
    const t = await ctx.fns.desktop.resolve({ app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host });
    const tree = opts.tree ?? true;
    const shot = (opts.screenshot ?? true) || !!opts.ocr;
    const r = await ctx.fns.desktop.call({
        host: t.host, tool: "get_window_state",
        args: {
            pid: t.pid, window_id: t.windowId,
            include_accessibility_tree: tree, include_screenshot: shot,
            ...(tree ? { max_elements: opts.maxElements ?? 800 } : {}),
            ...(opts.query ? { query: opts.query } : {}),
        },
    });
    const s = r.structured ?? {};
    const maxChars = opts.maxChars ?? 8000;
    let outline = String(s.tree_markdown ?? "");
    if (outline.length > maxChars) outline = outline.slice(0, maxChars) + `\n… (${outline.length - maxChars} more chars; use query to narrow)`;
    const image = r.images[0];
    let ocr;
    if (opts.ocr && image) {
        const width = Number(s.screenshot_width ?? 0), height = Number(s.screenshot_height ?? 0);
        const o = await ctx.fns.vision.appleOcr({ path: image });
        ocr = o.lines.map(l => ({
            text: l.text,
            x: Math.round((l.box.x + l.box.w / 2) * width), y: Math.round((l.box.y + l.box.h / 2) * height),
            w: Math.round(l.box.w * width), h: Math.round(l.box.h * height),
            confidence: Math.round(l.confidence * 100) / 100,
        }));
    }
    return {
        target: { ...t, title: s.window_title ?? t.title },
        title: s.window_title ?? t.title,
        snapshotId: s.snapshot_id,
        elements: Number(s.element_count ?? 0),
        outline,
        ...(image ? { image, width: s.screenshot_width, height: s.screenshot_height, scale: s.screenshot_scale } : {}),
        ...(ocr ? { ocr } : {}),
        ms: Math.round(performance.now() - started),
    };
}
