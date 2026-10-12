// POST /canvas/:id/item/:itemId — a canvas tab talks back. JSON body { state } merges keys into the tab's
// state (canvas.setState; the agent reads it next turn), { ping: { text, data? } } wakes the agent
// (canvas.ping). canvas.js forwards these from the tab's sandboxed page, which cannot call us itself.
/** Saves a canvas tab's state or pings its agent from the browser. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const agentId = String(opts.params.id ?? "");
    const itemId = Number(opts.params.itemId);
    if (!Number.isInteger(itemId)) return new Response("invalid item id", { status: 400 });
    const body: any = await opts.req.json().catch(() => null);
    if (!body || typeof body !== "object") return new Response("JSON body required", { status: 400 });
    try {
        const out: Record<string, unknown> = {};
        if (body.state && typeof body.state === "object" && !Array.isArray(body.state)) out.state = (await ctx.fns.canvas.setState({ agentId, itemId, state: body.state })).state;
        if (body.ping) out.ping = await ctx.fns.canvas.ping({ agentId, itemId, text: String(body.ping.text ?? ""), data: body.ping.data });
        if (!Object.keys(out).length) return new Response("nothing to do: pass state or ping", { status: 400 });
        return Response.json(out);
    } catch (error: any) {
        const message = String(error?.message ?? error);
        return new Response(message, { status: /rate limit/.test(message) ? 429 : /no tab/.test(message) ? 404 : 400 });
    }
}
