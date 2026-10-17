/**
 * Shows Hyper's live module dependency map (core/plugin filter, cycles, ownership-boundary breaks) as a page.
 *
 * Use for an address of the map: `/rpc/architectureMap.mapPage?{"scope":"core"}` — a canvas view tab (what the
 * `architectureMap.map` kind opens), a chat link or a browser tab. The interactive d3 map runs in its own frame
 * (the /architectureMap page in embed mode); the data is read fresh on every display.
 * @view
 * @param opts.scope Which modules to show. @default "all"
 * @param opts.minWeight Hide edges with fewer calls than this. @default 2 @minimum 1 @maximum 50
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Which modules to show. @default "all" */
    scope?: "all" | "core" | "plugins";
    /** Hide edges with fewer calls than this. @default 2 @minimum 1 @maximum 50 */
    minWeight?: number;
}): Promise<string> {
    const scope = ["all", "core", "plugins"].includes(String(opts.scope)) ? String(opts.scope) : "all";
    const minWeight = Math.max(1, Math.min(50, Number(opts.minWeight) || 2));
    const q = new URLSearchParams({ embed: "1", scope, minWeight: String(minWeight) });
    return ctx.fns.rpc.frame({ src: `/architectureMap?${q}`, title: "Hyper Architecture Map" });
}
