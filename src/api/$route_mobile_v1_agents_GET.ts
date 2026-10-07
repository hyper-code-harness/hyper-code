/** Lists active Hyper agents for the native mobile client. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const agents = await ctx.fns.session.list({});
    const pins = await ctx.fns.auth.pinnedIds({});
    const mentions = await ctx.fns.mentions.unreadByAgent({});
    return Response.json({
        version: 1,
        agents: agents.map(agent => ({
            id: agent.id,
            title: agent.title,
            model: agent.model,
            runState: agent.runState,
            unread: agent.unread,
            mentions: Number(mentions[agent.id] ?? 0),
            turns: agent.turns,
            updatedAt: agent.updatedAt,
            workspaceDir: agent.workspaceDir,
            pinned: pins.has(agent.id),
            delegated: agent.delegated,
            visibility: agent.visibility,
        })),
    });
}
