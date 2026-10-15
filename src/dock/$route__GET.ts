/** GET /dock — the Dock as it is for this person right now, for an in-place refresh after a layout change. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    return new Response(await ctx.fns.dock.render({}), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
