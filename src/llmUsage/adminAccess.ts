/**
 * Require the actual HTTP request to belong to an active instance owner before reading LLM accounting.
 *
 * Use at every accounting read entry point, including JSON reports and Canvas views. Re-resolves the incoming request instead of trusting rpc.render user overrides; rejects agents, null lifecycle sessions and calls without a request. The open single-owner instance follows auth.currentUser policy. This is an endpoint check, not a sandbox against trusted users with generic REPL or database access.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<void> {
    if (!session?.req || session.agent || session.agentId) throw new Error("LLM accounting requires an authenticated instance owner");
    const who = await ctx.fns.auth.currentUser({ req: session.req });
    if (who.setCookie) session.setCookie = who.setCookie;
    if (!who.user || who.user.role !== "owner" || who.user.disabledAt != null) throw new Error("LLM accounting requires an authenticated instance owner");
}
