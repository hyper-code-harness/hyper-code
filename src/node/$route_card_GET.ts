/** Live-region endpoint for the Hyper nodes card. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request }): Promise<Response> {
    return new Response(await ctx.fns.node.card({}), { headers: { "content-type": "text/html; charset=utf-8" } });
}
