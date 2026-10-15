// POST /nav/layout — one edit of the person's global menu layout (form or JSON, fields of nav.editLayout).
/** Applies a menu layout edit and asks the menu to redraw: HX-Trigger nav-tab (show that tab, the menu then refreshes) or nav-refresh. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    let body: any = {};
    const type = opts.req.headers.get("content-type") ?? "";
    try { body = type.includes("application/json") ? await opts.req.json() : Object.fromEntries(await opts.req.formData()); }
    catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
    const ops = ["add", "remove", "move", "size", "config", "addTab", "renameTab", "moveTab", "removeTab", "reset"];
    if (!ops.includes(String(body.op))) return Response.json({ error: "unknown op" }, { status: 400 });
    const sizes = ["S", "M", "L", "wide", "tall"];
    let config: Record<string, unknown> | undefined;
    if (body.config !== undefined) {
        try { config = typeof body.config === "string" ? JSON.parse(body.config) : body.config; } catch { return Response.json({ error: "config must be JSON" }, { status: 400 }); }
    }
    const out = await ctx.fns.nav.editLayout({
        op: body.op,
        tab: body.tab ? String(body.tab) : undefined,
        id: body.id ? String(body.id) : undefined,
        widget: body.widget ? String(body.widget) : undefined,
        size: sizes.includes(String(body.size)) ? body.size : undefined,
        dir: Number(body.dir) < 0 ? -1 : 1,
        title: body.title !== undefined ? String(body.title) : undefined,
        config,
    });
    return Response.json(out, {
        status: out.ok ? 200 : 400,
        headers: { "HX-Trigger": JSON.stringify(out.tab ? { "nav-tab": { id: out.tab } } : { "nav-refresh": null }), "cache-control": "no-store" },
    });
}
