/**
 * GET /chat/:id/panel — the ⋯ chat panel content, loaded when the panel opens.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    const html = await ctx.fns.chat.panel({ agentId: String(opts.params.id ?? "") });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
