// GET /agent/:id/goal-badge — the goal button of the chat's message box (agent.goalBadge), polled by its live
// region on the chat's topic.
/** Serves the goal button fragment for one chat.
 * @param opts.params Route parameters; `id` is the chat.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Route parameters; `id` is the chat. */
    params: Record<string, string>;
}): Promise<Response> {
    return new Response(await ctx.fns.agent.goalBadge({ agentId: String(opts.params.id ?? "") }), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
