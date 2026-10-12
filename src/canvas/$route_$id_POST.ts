// POST /canvas/:id — open/close an agent's canvas or set the chat width beside it. JSON or form body:
// { open?: boolean, chatWidth?: number, activeItemId?: number, closeItemId?: number }. Answers the
// resulting state with the panel fingerprint (rev).
/** Changes an agent's canvas state from the browser (canvas.update). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    const known = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [agentId] })) as any[]).length > 0;
    if (!known) return new Response("unknown agent", { status: 404 });
    const type = opts.req.headers.get("content-type") ?? "";
    let body: any = {};
    if (type.includes("application/json")) body = await opts.req.json().catch(() => ({}));
    else {
        const form = await opts.req.formData().catch(() => null);
        if (form?.has("open")) body.open = String(form.get("open"));
        if (form?.has("chatWidth")) body.chatWidth = String(form.get("chatWidth"));
        if (form?.has("activeItemId")) body.activeItemId = String(form.get("activeItemId"));
        if (form?.has("closeItemId")) body.closeItemId = String(form.get("closeItemId"));
    }
    const closeItemId = body.closeItemId == null || body.closeItemId === "" ? undefined : Number(body.closeItemId);
    const activeItemId = body.activeItemId == null || body.activeItemId === "" ? undefined : Number(body.activeItemId);
    if ((closeItemId !== undefined && !Number.isInteger(closeItemId)) || (activeItemId !== undefined && !Number.isInteger(activeItemId))) return new Response("invalid item id", { status: 400 });
    if (closeItemId !== undefined) await ctx.fns.canvas.close({ agentId, itemId: closeItemId });
    const open = typeof body.open === "boolean" ? body.open : body.open === "1" || body.open === "true" ? true : body.open === "0" || body.open === "false" ? false : undefined;
    const chatWidth = body.chatWidth == null || body.chatWidth === "" ? undefined : Number(body.chatWidth);
    if (chatWidth !== undefined && !Number.isFinite(chatWidth)) return new Response("invalid chatWidth", { status: 400 });
    try {
        const view = await ctx.fns.canvas.update({ agentId, open, chatWidth, activeItemId });
        return Response.json({ ...view, rev: (await ctx.fns.canvas.revision({ agentId })).panel });
    } catch (error: any) {
        return new Response(String(error?.message ?? error), { status: 400 });
    }
}
