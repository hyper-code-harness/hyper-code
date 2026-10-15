// Open a mounted plugin in a separate browser tab without navigating the current workspace.
/**
 * Opens a mounted plugin in a new browser tab and verifies that the new tab exists.
 * @param opts.plugin Mounted plugin name.
 */
export default async function (ctx: Context, _session: Session | null, opts: { plugin: string }) {
    const tabs = ["apps", ...(ctx.state.procs.modules ?? []).map(p => (p.namespaces[0] ?? p.name))];
    if (!tabs.includes(opts.plugin)) throw new Error(`no such tab: ${opts.plugin} (have ${tabs.join(", ")})`);

    const base = await ctx.fns.screen.eval({ code: "return location.origin", timeoutMs: 20_000 });
    const url = new URL(`/${opts.plugin}`, String(base)).href;
    const browserUrl = ctx.fns.procs.env.cdpUrl({});
    const response = await fetch(`${browserUrl}/json/new?${encodeURIComponent(url)}`, {
        method: "PUT",
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`failed to open browser tab through CDP (${response.status})`);
    const target: any = await response.json();
    await Bun.sleep(250);

    const open = await ctx.fns.browser.tabs({});
    const verifiedTarget = open.find((tab: any) => tab.id === target.id || (() => {
        try { return new URL(tab.url).pathname === `/${opts.plugin}`; } catch { return false; }
    })());
    if (!verifiedTarget) throw new Error(`new browser tab was not visible after opening ${url}`);

    return { tab: opts.plugin, url, opened: true, verified: true, targetId: verifiedTarget.id };
}
