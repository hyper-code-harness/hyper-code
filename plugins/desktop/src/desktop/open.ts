/**
 * Launches or focuses an application window, optionally opening files or URLs with it, and brings it to the front.
 *
 * Use to start work in an app or to make a minimized/hidden window visible (background actions work on covered windows, but hidden or minimized ones need this first). With front false the app is launched in the background without stealing focus.
 * @param opts.app Application name, bundle id or pid.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.urls Files or URLs to open with the application.
 * @param opts.front Bring the window to the front after launching. @default true
 * @param opts.window Case-insensitive substring of the window title to bring to the front.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Application name, bundle id or pid. */
        app: string;
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Files or URLs to open with the application. */
        urls?: string[];
        /** Bring the window to the front after launching. @default true */
        front?: boolean;
        /** Case-insensitive substring of the window title to bring to the front. */
        window?: string;
    },
): Promise<{ target: types.desktop.AppWindow; launched: boolean; front: boolean }> {
    let launched = false;
    if (opts.urls?.length || /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(opts.app)) {
        const isBundle = /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(opts.app);
        await ctx.fns.desktop.call({ host: opts.host, tool: "launch_app", args: { ...(isBundle ? { bundle_id: opts.app } : { name: opts.app }), ...(opts.urls?.length ? { urls: opts.urls } : {}) } });
        launched = true;
        await Bun.sleep(800);
    }
    const t = await ctx.fns.desktop.resolve({ app: opts.app, window: opts.window, host: opts.host, launch: true });
    const front = opts.front ?? true;
    if (front) await ctx.fns.desktop.call({ host: t.host, tool: "bring_to_front", args: { pid: t.pid, window_id: t.windowId } });
    return { target: t, launched, front };
}
