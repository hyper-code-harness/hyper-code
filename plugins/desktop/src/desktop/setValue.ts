/**
 * Sets the value of a text field or other editable UI element from desktop.snapshot directly through Accessibility.
 *
 * Faster and more reliable than typing: replaces the whole value of text fields, search fields, text areas and sliders without keyboard events. Some apps ignore programmatic values until the field is focused, so pass focus true or follow with desktop.key({ keys: ["return"] }) to commit.
 * @param opts.id Element id from desktop.snapshot.
 * @param opts.value New value as text.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 * @param opts.focus Focus the element before setting the value. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Element id from desktop.snapshot. */
        id: string;
        /** New value as text. */
        value: string;
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Focus the element before setting the value. @default true */
        focus?: boolean;
    },
): Promise<{ ok: boolean; id: string }> {
    const app = opts.app ?? "";
    if (opts.focus ?? true) await ctx.fns.desktop.helper({ args: ["set", app, opts.id, "true", "AXFocused"] }).catch(() => null);
    await ctx.fns.desktop.helper({ args: ["set", app, opts.id, opts.value] });
    return { ok: true, id: opts.id };
}
