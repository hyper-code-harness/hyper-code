// GET /canvas/:id/state — the canvas view (open, width, active tab) and panel fingerprint of one agent.
// canvas.js reads it when a tab becomes visible again or its event stream reconnects: a hidden tab has no
// event stream, so whatever the agent did meanwhile (opened a drawing, switched tabs) is caught up here.
/** Answers an agent's current canvas view and panel revision for a page catching up. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    const known = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [agentId] })) as any[]).length > 0;
    if (!known) return new Response("unknown agent", { status: 404 });
    const [view, rev] = await Promise.all([ctx.fns.canvas.get({ agentId }), ctx.fns.canvas.revision({ agentId })]);
    return Response.json({ ...view, rev: rev.panel }, { headers: { "cache-control": "no-store" } });
}
