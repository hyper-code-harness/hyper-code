/** Lists filtered stored news plus archive counts and source facets for the native mobile reader. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
    const view = url.searchParams.get("view") ?? "unread";
    const source = url.searchParams.get("source")?.trim() || undefined;
    const query = url.searchParams.get("q")?.trim() || undefined;
    const [items, stats, sources] = await Promise.all([
        ctx.fns.news.list({ limit, offset, source, query, unread: view === "unread" ? true : undefined, liked: view === "liked" ? true : undefined }),
        ctx.fns.news.stats({}),
        ctx.fns.news.sources({}),
    ]);
    return Response.json({
        version: 1,
        stats,
        sources,
        items: items.map((item: any) => ({
            id: String(item.id), title: item.title || "Untitled", source: item.source || "", sourceLabel: item.source_label || item.source || "",
            url: item.url || null, imageURL: item.image_url || null, author: item.author || null, points: item.points == null ? null : Number(item.points),
            comments: item.comments == null ? null : Number(item.comments), summary: item.summary || "", summaryLong: item.summary_long || "",
            topics: item.topics || [], liked: item.liked_at != null, read: item.read_at != null, shownAt: item.shown_at || item.fetched_at || null,
        })),
    });
}
