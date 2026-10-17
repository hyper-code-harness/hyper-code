/**
 * Shows the churn-versus-complexity (turbulence) map of Hyper source files as a page.
 *
 * Use for an address of the map: `/rpc/architectureMap.turbulencePage` or with `{"root":"core"}` — a canvas view
 * tab (what the `architectureMap.turbulence` kind opens), a chat link or a browser tab. The interactive d3 chart
 * runs in its own frame (the /architectureMap/turbulence page in embed mode).
 * @view
 * @param opts.root Only files of this source root; omit for all roots.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Only files of this source root; omit for all roots. */
    root?: string;
}): Promise<string> {
    const q = new URLSearchParams({ embed: "1" });
    if (opts.root) q.set("root", String(opts.root));
    return ctx.fns.rpc.frame({ src: `/architectureMap/turbulence?${q}`, title: "Hyper Turbulence" });
}
