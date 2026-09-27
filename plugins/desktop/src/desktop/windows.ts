/**
 * Lists the windows of one macOS application with ids, titles, frames and minimized state.
 *
 * Window ids (w0, w1, ...) are roots for desktop.snapshot. Requires Accessibility permission.
 * @param opts.app Application name, bundle id or pid; omit for the frontmost application.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Application name, bundle id or pid; omit for the frontmost application. */
        app?: string;
    },
): Promise<{ app: string; pid: number; windows: Array<{ id: string; title: string; frame?: { x: number; y: number; w: number; h: number }; minimized?: boolean }> }> {
    return await ctx.fns.desktop.helper({ args: ["windows", opts.app ?? ""] }) as { app: string; pid: number; windows: Array<{ id: string; title: string; frame?: { x: number; y: number; w: number; h: number }; minimized?: boolean }> };
}
