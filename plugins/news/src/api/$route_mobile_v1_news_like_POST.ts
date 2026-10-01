/** Sets or toggles one News like using a JSON body so URL-shaped stable identifiers are not route segments. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const body = await opts.req.json() as { id?: string; liked?: boolean };
    if (!body.id) return Response.json({ error: "invalid_request", message: "id is required" }, { status: 400 });
    const result = await ctx.fns.news.setLiked({ id: body.id, liked: typeof body.liked === "boolean" ? body.liked : undefined });
    return Response.json({ version: 1, ...result });
}
