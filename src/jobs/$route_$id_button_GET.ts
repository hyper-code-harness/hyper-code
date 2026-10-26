/**
 * GET /jobs/:id/button — the chat header's background-jobs button of agent :id, re-fetched by its live region.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
    /** Route path parameters. */
    params: Record<string, string>;
}) {
    const id = String(opts.params.id ?? "");
    // a poll for an archived or unknown agent must stop, not keep a half-broken loop running in the tab
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id = ?", params: [id] })) as any[])[0];
    if (!row) return new Response("not found", { status: 404 });
    return new Response(await ctx.fns.jobs.buttonHtml({ agentId: id }), { headers: { "content-type": "text/html; charset=utf-8" } });
}
