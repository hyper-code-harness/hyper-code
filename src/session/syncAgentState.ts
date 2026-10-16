/** Sync agent state for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Live agent instance to operate on. */
agent: types.agent.Agent }): Promise<types.agent.Agent> {
    const { agent } = opts;
    agent.messages = agent.parentId
        ? await ctx.fns.session.getFullMessages({ id: agent.id })
        : await ctx.fns.session.getMessages({ id: agent.id });
    agent.events = await ctx.fns.session.getEvents({ id: agent.id });
    return agent;
}
