/** GET /dock/panel — the Dock's side panel (the person's widgets). */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    return new Response(await ctx.fns.dock.panel({}), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
