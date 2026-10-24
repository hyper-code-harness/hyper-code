/** GET /dock/panel — the Dock's side panel (the person's widgets); `?edit=1` draws the edit controls. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const edit = new URL(opts.req.url).searchParams.get("edit") === "1";
    return new Response(await ctx.fns.dock.panel({ edit }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
