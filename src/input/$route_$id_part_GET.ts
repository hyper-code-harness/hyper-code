// A kind's own fragment endpoint — the grid kind answers its filter box here
// with just the rows. Only while the input is open: an answered card has no
// controls left to ask.
/**
 * Handles GET /input/:id/part — a kind-specific fragment of an open input, e.g. filtered grid rows.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
    /** Route path parameters. */
    params: Record<string, string>;
}): Promise<Response> {
    const input = await ctx.fns.input.get({ id: String(opts.params.id ?? "") });
    const kind = input ? (ctx.state as any).input?.kinds?.[input.kind] as types.input.Registered | undefined : undefined;
    if (!input || input.state !== "open" || !kind?.part) return new Response("", { status: 404 });
    const body = await kind.part(ctx, { input, query: new URL(opts.req.url).searchParams });
    return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
