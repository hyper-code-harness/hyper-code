/**
 * GET /dock/panel — the Dock's side panel (the person's widgets), with the chat open in the asking tab drawn current.
 *
 * The panel is a region of the shell that outlives page swaps, so the server learns which chat is open from the
 * page address htmx sends with every request (HX-Current-URL), not from the panel's own URL.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const page = opts.req.headers.get("hx-current-url") ?? "";
    let agentId: string | undefined;
    try { agentId = /^\/agent\/([A-Za-z0-9_-]+)\/?$/.exec(new URL(page).pathname)?.[1]; } catch { agentId = undefined; }
    return new Response(await ctx.fns.dock.panel({ agentId }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
