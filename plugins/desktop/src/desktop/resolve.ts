/**
 * Resolves an application name, bundle id or pid (and optional window title) to one on-screen window that desktop actions can target.
 *
 * Picks the frontmost titled on-screen window of the app, or the first window whose title contains the window filter. Launches the app in the background when it is not running and launch is true. Most desktop.* functions call this internally; use it directly to get a pid/windowId pair for desktop.call.
 * @param opts.app Application name (case-insensitive, substring allowed), bundle id or pid; omit for the frontmost application.
 * @param opts.window Case-insensitive substring of the window title, to choose among several windows.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.windowId Exact CGWindowID from a previous desktop result; wins over window.
 * @param opts.launch Launch the app in the background when it is not running. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Application name (case-insensitive, substring allowed), bundle id or pid; omit for the frontmost application. */
        app?: string;
        /** Case-insensitive substring of the window title, to choose among several windows. */
        window?: string;
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Exact CGWindowID from a previous desktop result; wins over window. */
        windowId?: number;
        /** Launch the app in the background when it is not running. @default true */
        launch?: boolean;
    },
): Promise<types.desktop.AppWindow> {
    const host = opts.host || "local";
    type Win = { app_name: string; pid: number; window_id: number; title: string; is_on_screen: boolean; layer: number; z_index: number; bounds: { x: number; y: number; width: number; height: number } };
    const listWindows = async (pid?: number) => ((await ctx.fns.desktop.call({ host, tool: "list_windows", args: pid ? { pid } : {} })).structured?.windows ?? []) as Win[];
    let pid: number | undefined;
    let appName = opts.app ?? "";
    if (opts.app && /^\d+$/.test(opts.app)) pid = Number(opts.app);
    else if (opts.app) {
        const q = opts.app.toLowerCase();
        // list_apps costs ~1 s; reuse a recent name → pid mapping while that process still owns windows.
        const cache: Map<string, { pid: number; name: string; at: number }> = ((globalThis as any).__desktopAppCache ??= new Map());
        const hitCache = cache.get(`${host}:${q}`);
        if (hitCache && Date.now() - hitCache.at < 10 * 60_000) {
            const ws = (await listWindows(hitCache.pid)).filter(w => w.pid === hitCache.pid && w.layer === 0);
            if (ws.length) { pid = hitCache.pid; appName = hitCache.name; }
        }
    }
    if (opts.app && pid === undefined && !/^\d+$/.test(opts.app)) {
        const apps = ((await ctx.fns.desktop.call({ host, tool: "list_apps" })).structured?.apps ?? []) as Array<{ name: string; bundle_id: string; pid: number; running: boolean }>;
        const q = opts.app.toLowerCase();
        const hit = apps.find(a => a.name.toLowerCase() === q || a.bundle_id.toLowerCase() === q) ?? apps.find(a => a.name.toLowerCase().includes(q));
        if (!hit) throw new Error(`desktop: no app matching "${opts.app}" on ${host}`);
        appName = hit.name;
        if (hit.running && hit.pid) pid = hit.pid;
        else if (opts.launch ?? true) {
            const l = await ctx.fns.desktop.call({ host, tool: "launch_app", args: { bundle_id: hit.bundle_id } });
            pid = l.structured?.pid;
            await Bun.sleep(800);
        } else throw new Error(`desktop: ${hit.name} is not running on ${host}`);
    } else if (!opts.app) {
        const apps = ((await ctx.fns.desktop.call({ host, tool: "list_apps" })).structured?.apps ?? []) as Array<{ name: string; pid: number; active: boolean }>;
        const front = apps.find(a => a.active);
        if (!front) throw new Error(`desktop: no frontmost app on ${host}`);
        pid = front.pid; appName = front.name;
    }
    if (opts.app && pid !== undefined && !/^\d+$/.test(opts.app)) {
        const cache: Map<string, { pid: number; name: string; at: number }> = (globalThis as any).__desktopAppCache;
        cache?.set(`${host}:${opts.app.toLowerCase()}`, { pid, name: appName, at: Date.now() });
    }
    const wins = (await listWindows(pid)).filter(w => w.layer === 0 && w.pid === pid);
    const titled = wins.filter(w => w.title && w.bounds.height > 60);
    const f = opts.window?.toLowerCase();
    const pick = (opts.windowId ? wins.find(w => w.window_id === opts.windowId) : undefined)
        ?? (f ? titled.find(w => w.title.toLowerCase().includes(f)) : undefined)
        ?? titled.filter(w => w.is_on_screen).sort((a, b) => b.z_index - a.z_index)[0]
        ?? titled.sort((a, b) => b.z_index - a.z_index)[0];
    if (!pick) throw new Error(`desktop: ${appName || pid} has no usable window on ${host}${f ? ` matching "${opts.window}"` : ""}; open one first`);
    return { host, pid: pick.pid, windowId: pick.window_id, app: pick.app_name || appName, title: pick.title, bounds: pick.bounds };
}
