/** Renders the Shared Agents registry page. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const currentAgentId = url.searchParams.get("from") ?? undefined;
    const selectedAgentId = url.searchParams.get("agent") ?? undefined;
    const main = await ctx.fns.sharedAgent.page({ currentAgentId, selectedAgentId });
    return { title: "Shared Agents", currentId: currentAgentId, main };
}
