// GET /agent/:id/plan-badge — the plan progress ring of the chat's message box (agent.planBadge), polled by its
// live region on the chat's topic. Empty while the chat has no plan.
/** Serves the plan progress fragment for one chat.
 * @param opts.params Route parameters; `id` is the chat.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route parameters; `id` is the chat. */
    params: Record<string, string>;
}): Promise<Response> {
    return new Response(await ctx.fns.agent.planBadge({ agentId: String(opts.params.id ?? "") }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
