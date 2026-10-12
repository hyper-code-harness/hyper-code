// GET /canvas/:id/mobile — standalone Canvas surface for native clients.
/** Renders an agent's existing Canvas panel as a full-page mobile surface. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const agentId = String(opts.params.id ?? "");
    const known = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [agentId] })) as any[]).length > 0;
    if (!known) return new Response("unknown agent", { status: 404 });
    const id = ctx.fns.procs.ui.escape({ text: agentId });
    const panel = await ctx.fns.canvas.panelHtml({ agentId });
    return {
        currentId: agentId,
        title: "Canvas",
        headExtra: `<style>
          #main { overflow:hidden !important; padding:0 !important; }
          [data-mobile-canvas] > .canvas-panel { display:flex !important; margin:0 !important; border:0 !important; border-radius:0 !important; }
          [data-mobile-canvas] > .canvas-resizer, [data-mobile-canvas] [data-canvas-toggle="close"] { display:none !important; }
        </style>`,
        main: `<div data-page="agent" data-mobile-canvas data-canvas-agent="${id}" data-canvas-open class="flex min-h-0 min-w-0 flex-1 bg-base-200">${panel}</div>`,
    };
}
