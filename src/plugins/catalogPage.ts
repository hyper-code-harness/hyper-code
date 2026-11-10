/**
 * Shows the plugin catalog — install, update and remove plugins — as a page with an address.
 *
 * Use to put the plugin catalog in front of a person: a canvas view tab, a chat link or a browser tab at `/rpc/plugins.catalogPage`. The catalog with its review and confirm forms runs in its own frame (the /plugins/listing page in embed mode, same origin, so its forms post as usual); q pre-fills the search.
 * @view
 * @param opts.q Search words for the catalog, e.g. "charts".
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Search words for the catalog, e.g. "charts". */
        q?: string;
    },
): Promise<string> {
    const q = String(opts.q ?? "").trim().slice(0, 200);
        return ctx.fns.rpc.frame({ src: "/plugins/listing?embed=1" + (q ? "&q=" + encodeURIComponent(q) : ""), title: "Plugin catalog" });
}
