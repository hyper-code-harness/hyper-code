/** POST /dock/layout — saves the person's Dock layout (JSON body { top, bottom, hidden }) or resets it ({ reset: true }). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    let body: any;
    try { body = await opts.req.json(); } catch { return Response.json({ error: "JSON body required" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "object body required" }, { status: 400 });
    const saved = await ctx.fns.dock.saveLayout(body.reset === true ? { reset: true } : { layout: body });
    return Response.json(saved, { headers: { "cache-control": "no-store" } });
}
