/** Toggles liked state for one native news item. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    let body: any = {}; try { body = await opts.req.json(); } catch {}
    const result = await ctx.fns.news.setLiked({ id: opts.params.id!, liked: typeof body.liked === "boolean" ? body.liked : undefined });
    return Response.json({ version: 1, ...result });
}
