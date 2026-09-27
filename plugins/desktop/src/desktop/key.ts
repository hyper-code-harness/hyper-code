/**
 * Presses a key or keyboard shortcut in an app window in the background, e.g. return, escape, tab, arrows, or cmd+k.
 *
 * Accepts a combo string like "cmd+shift+p", "return" or "down". A single key goes through press_key, combos through hotkey. Pass element/text/x+y to focus a field first. Menu shortcuts in some apps only fire in the foreground; pass foreground true then.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title when the app has several windows.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.element Element index from the latest desktop.look of this window.
 * @param opts.x Horizontal position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.y Vertical position in window screenshot pixels from desktop.look (or its ocr lines).
 * @param opts.text Visible label to target, resolved via Accessibility then OCR.
 * @param opts.key Key or combo: return, escape, tab, space, delete, up, down, left, right, pageup, pagedown, home, end, f1-f12, a letter, or modifiers joined with + such as cmd+k.
 * @param opts.foreground Briefly bring the window to front, press, then restore the previous app. @default false
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
        /** Key or combo: return, escape, tab, space, delete, up, down, left, right, pageup, pagedown, home, end, f1-f12, a letter, or modifiers joined with + such as cmd+k. */
        key: string;
        /** Briefly bring the window to front, press, then restore the previous app. @default false */
        foreground?: boolean;
        /** Look again after the action: none, tree, screenshot or both. @default screenshot */
        after?: "none" | "tree" | "screenshot" | "both";
        /** Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; target: types.desktop.AppWindow; via: "element" | "pixel" | "window"; element?: number; x?: number; y?: number; label?: string; summary: string; ms: number; look?: { title: string; outline: string; image?: string; elements: number } }> {
    const parts = opts.key.split("+").map(p => p.trim().toLowerCase()).filter(Boolean);
    const mods = new Set(["cmd", "command", "shift", "option", "alt", "opt", "ctrl", "control", "fn"]);
    const norm = (m: string) => ({ command: "cmd", opt: "option", alt: "option", control: "ctrl" } as Record<string, string>)[m] ?? m;
    const modifiers = parts.filter(p => mods.has(p)).map(norm);
    const main = parts.filter(p => !mods.has(p));
    if (main.length !== 1) throw new Error(`desktop.key: "${opts.key}" must contain exactly one non-modifier key`);
    const args: Record<string, unknown> = modifiers.length ? { keys: [...modifiers, main[0]] } : { key: main[0] };
    if (opts.foreground) args.delivery_mode = "foreground";
    return await ctx.fns.desktop.act({ tool: modifiers.length ? "hotkey" : "press_key", args, app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, element: opts.element, x: opts.x, y: opts.y, text: opts.text, after: opts.after ?? "screenshot", waitMs: opts.waitMs });
}
