/** POST /dock/panel — one edit of the person's side panel widgets (form or JSON fields of dock.editPanel); answers with the panel in edit mode. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    let body: any = {};
    const type = opts.req.headers.get("content-type") ?? "";
    try { body = type.includes("application/json") ? await opts.req.json() : Object.fromEntries(await opts.req.formData()); }
    catch { return new Response("invalid body", { status: 400 }); }
    const op = String(body.op);
    if (!["add", "remove", "move", "config", "reset"].includes(op)) return new Response("unknown op", { status: 400 });
    let config: Record<string, unknown> | undefined;
    if (body.config !== undefined) {
        try { config = typeof body.config === "string" ? JSON.parse(body.config) : body.config; } catch { return new Response("config must be JSON", { status: 400 }); }
    }
    const out = await ctx.fns.dock.editPanel({
        op: op as "add" | "remove" | "move" | "config" | "reset",
        id: body.id ? String(body.id) : undefined,
        widget: body.widget ? String(body.widget) : undefined,
        dir: Number(body.dir) < 0 ? -1 : 1,
        config,
    });
    if (!out.ok) return new Response(out.error ?? "edit failed", { status: 400 });
    return new Response(await ctx.fns.dock.panel({ edit: true }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
