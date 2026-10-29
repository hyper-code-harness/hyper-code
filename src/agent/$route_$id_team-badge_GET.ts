/**
 * GET /agent/:id/team-badge — the subagents badge of chat :id in its input, re-fetched by its live region.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    return new Response(await ctx.fns.agent.teamBadge({ agentId: String(opts.params.id ?? "") }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
