/**
 * Loads what every chat header part receives for one chat: the agent, its parent and the inherited message count.
 *
 * Returns null when the agent does not exist or is archived.
 * @param opts.agentId Agent whose chat is drawn.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent whose chat is drawn. */
        agentId: string;
    },
): Promise<types.chat.RenderContext | null> {
    const id = String(opts.agentId ?? "");
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return null;
    const parentId = agent.parentId ? String(agent.parentId) : "";
    const parent = parentId ? (ctx.state as any).agent?.[parentId] ?? await ctx.fns.session.load({ id: parentId }) : null;
    const inheritedCount = agent.parentId
        ? (await ctx.fns.session.getFullMessages({ id })).length - (await ctx.fns.session.getMessages({ id })).length
        : 0;
    return { agent, parent, inheritedCount };
}
