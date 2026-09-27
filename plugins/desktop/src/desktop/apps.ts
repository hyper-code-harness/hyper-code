/**
 * Lists applications on this Mac or a remote one: running apps with pids and windows, plus installed apps that can be launched.
 *
 * Use to discover exact app names, bundle ids and pids for the other desktop functions.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local
 * @param opts.running Only return running applications. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias of a remote Mac with Cua Driver; omit for this machine. @default local */
        host?: string;
        /** Only return running applications. @default true */
        running?: boolean;
    },
): Promise<Array<{ name: string; bundleId: string; pid: number; running: boolean; active: boolean; windows: number }>> {
    const r = await ctx.fns.desktop.call({ host: opts.host, tool: "list_apps" });
    const apps = (r.structured?.apps ?? []) as Array<{ name: string; bundle_id: string; pid: number; running: boolean; active: boolean; windows?: unknown[] }>;
    return apps
        .filter(a => !(opts.running ?? true) || a.running)
        .map(a => ({ name: a.name, bundleId: a.bundle_id, pid: a.pid, running: a.running, active: a.active, windows: a.windows?.length ?? 0 }));
}
