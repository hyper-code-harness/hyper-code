// Chat header button: the agent's background commands — an icon with the number running; opens the jobs list.
export default {
    order: 9,
    render: async (ctx: Context, _session: Session | null, view: types.chat.RenderContext) => await ctx.fns.jobs.buttonHtml({ agentId: view.agent.id }),
} satisfies types.chat.Button;
