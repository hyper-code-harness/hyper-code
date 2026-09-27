/**
 * Lists top-level windows with app name, pid, window id, title, bounds and visibility on this Mac or a remote one.
 *
 * Use to see what is open on screen or to pick a windowId for other desktop functions. Menu-bar strips and untitled helper windows are filtered unless all is true.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.app Only windows of this application name (case-insensitive substring) or pid.
 * @param opts.onScreen Only windows on the current Space and on screen. @default true
 * @param opts.all Include untitled and tiny helper windows. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Only windows of this application name (case-insensitive substring) or pid. */
        app?: string;
        /** Only windows on the current Space and on screen. @default true */
        onScreen?: boolean;
        /** Include untitled and tiny helper windows. @default false */
        all?: boolean;
    },
): Promise<Array<{ app: string; pid: number; windowId: number; title: string; onScreen: boolean; bounds: { x: number; y: number; width: number; height: number } }>> {
    const r = await ctx.fns.desktop.call({ host: opts.host, tool: "list_windows", args: { on_screen_only: opts.onScreen ?? true } });
    const wins = (r.structured?.windows ?? []) as Array<{ app_name: string; pid: number; window_id: number; title: string; is_on_screen: boolean; layer: number; bounds: { x: number; y: number; width: number; height: number } }>;
    const q = opts.app?.toLowerCase();
    return wins
        .filter(w => w.layer === 0 && (opts.all || (w.title && w.bounds.height > 60)))
        .filter(w => !q || String(w.pid) === q || w.app_name.toLowerCase().includes(q))
        .map(w => ({ app: w.app_name, pid: w.pid, windowId: w.window_id, title: w.title, onScreen: w.is_on_screen, bounds: w.bounds }));
}
