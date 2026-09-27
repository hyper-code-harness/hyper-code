/** Fork for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Human-readable title. */
title?: string;
        /** Number of parent messages inherited by the child. */
offset?: number;
        /** Child listing policy. User-created forks normally keep the default nav. @default nav */
visibility?: "nav" | "team" | "hidden" }): Promise<types.agent.Agent> {
    const { id } = opts;
    const parent = (ctx.state as any).agent?.[id] ?? (await ctx.fns.session.load({ id }));
    if (!parent) throw new Error(`agent not found: ${id}`);
    const fullCount = (await ctx.fns.session.getFullMessages({ id })).length;
    const agent = await ctx.fns.agent.start({
        model: parent.model,
        systemPrompt: parent.systemPrompt,
        tools: parent.tools,
        title: opts.title ?? (parent.title ? `${parent.title} (fork)` : ""),
        workspaceDir: parent.workspaceDir,
        workspaceHost: parent.workspaceHost,
        parentId: parent.id,
        visibility: opts.visibility ?? "nav",
        forkOffset: opts.offset ?? fullCount,
    });
    agent.scratchpad = JSON.parse(JSON.stringify(parent.scratchpad ?? {}));
    await ctx.fns.session.save({ agent });
    await ctx.fns.events.emitAgentsChanged({ agentId: agent.id, reason: "fork" });
    return agent;
}
