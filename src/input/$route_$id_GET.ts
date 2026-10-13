/**
 * Handles GET /input/:id — the current card of a chat input (form or answer) as an HTML fragment.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    return new Response(await ctx.fns.input.card({ id: String(opts.params.id ?? "") }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
