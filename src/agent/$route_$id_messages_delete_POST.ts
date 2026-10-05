/** Handles the id messages delete post HTTP route.  * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request;
        /** Values bound to the operation. */
params: Record<string, string> }) {
    const id = opts.params.id!;
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return Response.json({ error: "not found" }, { status: 404 });
    const form = await opts.req.formData();
    const idx = Number(form.get("idx"));
    const mode = String(form.get("mode") || "one");
    const res = mode === "from"
        ? await ctx.fns.session.truncateMessagesFrom({ id, from: idx })
        : await ctx.fns.session.deleteMessageAt({ id, idx });
    if (!res.ok) return Response.json({ error: res.reason || "delete failed" }, { status: 400 });
    await ctx.fns.session.syncAgentState({ agent });
    // HTMX 4 does not follow a 303 as a full-page navigation. Ask it to reload
    // explicitly; native form submissions retain the redirect fallback.
    if (opts.req.headers.get("hx-request") === "true") return new Response(null, { status: 204, headers: { "HX-Refresh": "true" } });
    return new Response(null, { status: 303, headers: { location: `/agent/${encodeURIComponent(id)}` } });
}
