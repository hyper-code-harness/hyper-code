// GET /canvas/:id/panel — the canvas panel of one agent (tabs + active body), fetched by canvas.js after
// tabs change so the chat beside it is never re-rendered.
/** Answers an agent's canvas panel HTML for an in-place refresh. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    const known = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [agentId] })) as any[]).length > 0;
    if (!known) return new Response("unknown agent", { status: 404 });
    return new Response(await ctx.fns.canvas.panelHtml({ agentId }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
