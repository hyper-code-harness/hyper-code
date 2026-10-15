// GET /nav/items?q=…&tab=…&edit=1 — the global menu (⌘/) body: the tab's widget grid while q is empty,
// grouped results of the tab's search sources once the person types.
/**
 * Renders the global menu body for the current viewer: nav.home for an empty query, nav.searchAll otherwise.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const tab = url.searchParams.get("tab")?.trim() || undefined;
    const edit = url.searchParams.get("edit") === "1";
    const html = q ? (await ctx.fns.nav.searchAll({ q, tab })).html : await ctx.fns.nav.home({ tab, edit });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
