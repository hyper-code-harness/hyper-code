/**
 * Lists running regular macOS applications with pid, bundle id and which one is frontmost.
 *
 * Use to discover the app name or pid to pass to desktop.windows, desktop.snapshot, desktop.activate and other desktop functions. Does not need Accessibility permission.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<Array<{ name: string; pid: number; bundleId: string; active: boolean; hidden: boolean }>> {
    const r = await ctx.fns.desktop.helper({ args: ["apps"] }) as { apps: Array<{ name: string; pid: number; bundleId: string; active: boolean; hidden: boolean }> };
    return r.apps;
}
