/** Returns the viewer's left-rail unread @mentions badge (mentions.badge) for a live refresh. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    return new Response(await ctx.fns.mentions.badge({}), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
