/**
 * Replaces the value of a text field, search field, slider or other editable Accessibility element directly, without typing.
 *
 * Fastest reliable way to fill native form fields. Target with element (index from desktop.look) or text (field label/placeholder). Web and Electron inputs often ignore programmatic values; use desktop.type there.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title when the app has several windows.
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.element Element index from the latest desktop.look of this window.
 * @param opts.text Label, placeholder or current value of the field to set, resolved via Accessibility.
 * @param opts.value New value; Accessibility coerces it to the element's native type.
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
        /** Label, placeholder or current value of the field to set, resolved via Accessibility. */
        text?: string;
        /** New value; Accessibility coerces it to the element's native type. */
        value: string;
        /** Look again after the action: none, tree, screenshot or both. @default screenshot */
        after?: "none" | "tree" | "screenshot" | "both";
        /** Pause before the after-look so the UI settles. @default 700 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; target: types.desktop.AppWindow; via: "element" | "pixel" | "window"; element?: number; x?: number; y?: number; label?: string; summary: string; ms: number; look?: { title: string; outline: string; image?: string; elements: number } }> {
    if (opts.element === undefined && opts.text === undefined) throw new Error("desktop.setValue: pass element or text");
    return await ctx.fns.desktop.act({ tool: "set_value", args: { value: opts.value }, app: opts.app, window: opts.window, windowId: opts.windowId, host: opts.host, element: opts.element, text: opts.text, after: opts.after ?? "tree", waitMs: opts.waitMs });
}
