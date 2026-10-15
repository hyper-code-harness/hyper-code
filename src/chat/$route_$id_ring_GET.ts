/**
 * GET /chat/:id/ring — the context ring of the chat input, refreshed on the agent's events.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    return new Response(await ctx.fns.chat.contextRing({ agentId: String(opts.params.id ?? "") }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
