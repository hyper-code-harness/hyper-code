/**
 * Performs one Cua Driver action on a window element, a screenshot pixel point or a visible text label, then optionally looks again.
 *
 * Shared engine of desktop.click, desktop.type, desktop.key, desktop.scroll and desktop.setValue: resolves the window, reuses the element indexes and screenshot of the latest desktop.look of that window (taking a fresh one when missing), finds text via desktop.locate, calls the tool in background delivery mode (no focus steal) and, with after, waits and returns a fresh look so the caller sees the result. Use directly for tools such as double_click, right_click, drag or hotkey with element targets.
 * @param opts.tool Cua Driver action tool: click, double_click, right_click, type_text, press_key, hotkey, scroll, set_value.
 * @param opts.args Extra tool arguments (text, key, keys, direction, amount, value, button, count, modifier, delivery_mode, ...).
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.element Element index from the latest desktop.look of this window.
 * @param opts.x Horizontal position in the window screenshot pixels from desktop.look.
 * @param opts.y Vertical position in the window screenshot pixels from desktop.look.
 * @param opts.text Visible label to act on, resolved with desktop.locate (Accessibility first, then OCR).
 * @param opts.after Look again after the action: none, tree (outline only), screenshot, or both. @default none
 * @param opts.waitMs Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Cua Driver action tool: click, double_click, right_click, type_text, press_key, hotkey, scroll, set_value. */
        tool: string;
        /** Extra tool arguments (text, key, keys, direction, amount, value, button, count, modifier, delivery_mode, ...). */
        args?: Record<string, unknown>;
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Case-insensitive substring of the window title. */
        window?: string;
        /** Exact CGWindowID from a previous desktop result; wins over window. */
        windowId?: number;
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Element index from the latest desktop.look of this window. */
        element?: number;
        /** Horizontal position in the window screenshot pixels from desktop.look. */
        x?: number;
        /** Vertical position in the window screenshot pixels from desktop.look. */
        y?: number;
        /** Visible label to act on, resolved with desktop.locate (Accessibility first, then OCR). */
        text?: string;
        /** Look again after the action: none, tree (outline only), screenshot, or both. @default none */
        after?: "none" | "tree" | "screenshot" | "both";
        /** Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; target: types.desktop.AppWindow; via: "element" | "pixel" | "window"; element?: number; x?: number; y?: number; label?: string; summary: string; ms: number; look?: { title: string; outline: string; image?: string; elements: number } }> {
    const started = performance.now();
    let element = opts.element, x = opts.x, y = opts.y, label: string | undefined;
    let t: types.desktop.AppWindow;
    if (opts.text !== undefined && element === undefined && x === undefined) {
        const loc = await ctx.fns.desktop.locate({ text: opts.text, app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host });
        t = loc.target; element = loc.element; x = loc.x; y = loc.y; label = loc.label;
    } else {
        t = await ctx.fns.desktop.resolve({ app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host });
    }
    const snaps: Map<string, any> = ((globalThis as any).__desktopCuaSnaps ??= new Map());
    const key = `${t.host}:${t.pid}:${t.windowId}`;
    const args: Record<string, unknown> = { pid: t.pid, window_id: t.windowId, ...(opts.args ?? {}) };
    let via: "element" | "pixel" | "window" = "window";
    if (element !== undefined) {
        let snap = snaps.get(key);
        if (!snap?.snapshotId) { await ctx.fns.desktop.look({ app: String(t.pid), host: t.host, windowId: t.windowId, screenshot: false }); snap = snaps.get(key); }
        args.element_index = element; args.snapshot_id = snap?.snapshotId; via = "element";
    } else if (x !== undefined && y !== undefined) {
        const snap = snaps.get(key);
        if (!snap?.hasScreenshot) await ctx.fns.desktop.look({ app: String(t.pid), host: t.host, windowId: t.windowId, tree: false });
        args.x = x; args.y = y; via = "pixel";
    }
    const r = await ctx.fns.desktop.call({ host: t.host, tool: opts.tool, args });
    const summary = String(r.structured?.summary ?? r.text ?? "").slice(0, 300);
    const after = opts.after ?? "none";
    let look;
    if (after !== "none") {
        await Bun.sleep(opts.waitMs ?? 700);
        const l = await ctx.fns.desktop.look({ app: String(t.pid), windowId: t.windowId, host: t.host, tree: after !== "screenshot", screenshot: after !== "tree" });
        look = { title: l.title, outline: l.outline, image: l.image, elements: l.elements };
    }
    return { ok: !r.isError, target: t, via, element, x, y, label, summary, ms: Math.round(performance.now() - started), ...(look ? { look } : {}) };
}
