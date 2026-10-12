// GET /canvas/:id/item/:itemId/frame — the sandboxed document of an html canvas tab (canvas.htmlFrame).
/** Serves an html canvas tab's page under a sandboxing CSP. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const itemId = Number(opts.params.itemId);
    if (!Number.isInteger(itemId)) return new Response("invalid item id", { status: 400 });
    return await ctx.fns.canvas.htmlFrame({ agentId: String(opts.params.id ?? ""), itemId });
}
