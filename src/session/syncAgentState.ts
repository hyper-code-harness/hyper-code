/** Sync agent state for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Live agent instance to operate on. */
agent: types.agent.Agent }): Promise<types.agent.Agent> {
    const { agent } = opts;
    const ownMessages = await ctx.fns.session.getMessages({ id: agent.id });
    agent.messages = agent.parentId ? await ctx.fns.session.getFullMessages({ id: agent.id }) : ownMessages;
    agent.inheritedMessageCount = agent.parentId ? Math.max(0, agent.messages.length - ownMessages.length) : 0;
    agent.events = await ctx.fns.session.getEvents({ id: agent.id });
    return agent;
}
