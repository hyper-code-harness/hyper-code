/**
 * Serves the "who is online" live region: everyone in this Hyper (left bar) or one chat (inspector header).
 * Query: `agent=<id>` for one chat; `layout=column` for the left bar.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const q = new URL(opts.req.url).searchParams;
    const html = ctx.fns.auth.onlineRegion({ agentId: q.get("agent") || undefined, layout: q.get("layout") === "column" ? "column" : "row", html: await ctx.fns.auth.online({ agentId: q.get("agent") || undefined, layout: q.get("layout") === "column" ? "column" : "row" }) });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
