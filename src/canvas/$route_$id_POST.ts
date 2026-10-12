// POST /canvas/:id — open/close an agent's canvas or set the chat width beside it. JSON or form body:
// { open?: boolean, chatWidth?: number }. Answers the resulting state.
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
    }
    const open = typeof body.open === "boolean" ? body.open : body.open === "1" || body.open === "true" ? true : body.open === "0" || body.open === "false" ? false : undefined;
    const chatWidth = body.chatWidth == null || body.chatWidth === "" ? undefined : Number(body.chatWidth);
    if (chatWidth !== undefined && !Number.isFinite(chatWidth)) return new Response("invalid chatWidth", { status: 400 });
    return Response.json(await ctx.fns.canvas.update({ agentId, open, chatWidth }));
}
