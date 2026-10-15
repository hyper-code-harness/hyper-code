/** POST /dock/pin — pins or unpins a chat or page in the person's Dock. Form or JSON { kind, target, pinned }. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    let body: any = {};
    const type = opts.req.headers.get("content-type") ?? "";
    try { body = type.includes("application/json") ? await opts.req.json() : Object.fromEntries(await opts.req.formData()); }
    catch { return Response.json({ error: "invalid body" }, { status: 400 }); }
    try {
        const out = await ctx.fns.dock.pin({ kind: body.kind, target: String(body.target ?? ""), pinned: !(body.pinned === false || body.pinned === "0" || body.pinned === "false") });
        return Response.json(out, { headers: { "HX-Trigger": JSON.stringify({ "nav-refresh": null, "dock-refresh": null }), "cache-control": "no-store" } });
    } catch (error: any) {
        return Response.json({ error: String(error?.message ?? error) }, { status: 400 });
    }
}
