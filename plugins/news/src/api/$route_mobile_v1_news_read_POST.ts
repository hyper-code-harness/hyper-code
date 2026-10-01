/** Marks one News item read using a JSON body so URL-shaped stable identifiers are never encoded into a route segment. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const body = await opts.req.json() as { id?: string };
    if (!body.id) return Response.json({ error: "invalid_request", message: "id is required" }, { status: 400 });
    const result = await ctx.fns.news.setRead({ ids: [body.id], read: true });
    return Response.json({ version: 1, id: body.id, read: true, updated: result.updated });
}
