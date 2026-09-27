/**
 * Performs an Accessibility action such as press on a UI element from desktop.snapshot, without moving the mouse.
 *
 * Preferred way to click native buttons, menu items, checkboxes, tabs and links: works in background windows and does not steal the pointer. Use action ShowMenu to open context menus, Increment/Decrement for steppers, Confirm/Cancel for dialogs, Pick for menu items. Falls back to nothing: if it fails, use desktop.click({ id }) for a real mouse click.
 * @param opts.id Element id from desktop.snapshot, e.g. f.0.3.1 or m.2.0.5.
 * @param opts.app Application name, bundle id or pid that the snapshot was taken from; omit for the frontmost application.
 * @param opts.action Accessibility action name with or without the AX prefix. @default Press
 * @param opts.waitMs Pause after the action so the UI settles before the next snapshot. @default 300 @minimum 0 @maximum 10000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Element id from desktop.snapshot, e.g. f.0.3.1 or m.2.0.5. */
        id: string;
        /** Application name, bundle id or pid that the snapshot was taken from; omit for the frontmost application. */
        app?: string;
        /** Accessibility action name with or without the AX prefix. @default Press */
        action?: string;
        /** Pause after the action so the UI settles before the next snapshot. @default 300 @minimum 0 @maximum 10000 */
        waitMs?: number;
    },
): Promise<{ ok: boolean; id: string; action: string }> {
    const raw = opts.action ?? "Press";
    const action = raw.startsWith("AX") ? raw : `AX${raw}`;
    await ctx.fns.desktop.helper({ args: ["action", opts.app ?? "", opts.id, action] });
    await Bun.sleep(opts.waitMs ?? 300);
    return { ok: true, id: opts.id, action };
}
