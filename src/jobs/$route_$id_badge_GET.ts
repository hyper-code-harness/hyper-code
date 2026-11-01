/**
 * GET /jobs/:id/badge — the background-jobs badge of chat :id next to its Stop button, re-fetched by its live region.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    return new Response(await ctx.fns.jobs.badge({ agentId: String(opts.params.id ?? "") }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
