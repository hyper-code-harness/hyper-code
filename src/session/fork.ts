/** Create a child inheriting its parent's transcript and result references. Clone durable scratchpad state and plans, but omit obsolete result bodies and their sequence counter. */
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
    const full = await ctx.fns.session.getFullMessages({ id });
    const fullCount = full.length;
    const agent = await ctx.fns.agent.start({
        model: parent.model,
        systemPrompt: parent.systemPrompt,
        systemPromptName: parent.systemPromptName,
        systemPromptCore: parent.systemPromptCore,
        tools: parent.tools,
        title: opts.title ?? (parent.title ? `${parent.title} (fork)` : ""),
        workspaceDir: parent.workspaceDir,
        workspaceHost: parent.workspaceHost,
        parentId: parent.id,
        visibility: opts.visibility ?? "nav",
        forkOffset: opts.offset ?? fullCount,
    });
    // Omit obsolete result bodies before cloning, while preserving plans and other durable state.
    const { results: _legacyResults, resultSeq: _legacyResultSeq, ...durableScratchpad } = parent.scratchpad ?? {};
    agent.scratchpad = JSON.parse(JSON.stringify(durableScratchpad));
    // Files attached to the plan's tasks come along with the plan. One the parent already handed to the model counts
    // as handed over only if that message is inherited too: a fork from an earlier point must get the file again.
    const planTasks: any[] = Array.isArray(agent.scratchpad.plan?.tasks) ? agent.scratchpad.plan.tasks : [];
    if (planTasks.some(task => (Array.isArray(task?.attachments) ? task.attachments : []).some((file: any) => file?.sentAt))) {
        const inherited = new Set<string>();
        for (const message of full.slice(0, opts.offset ?? fullCount))
            for (const part of Array.isArray((message as any)?.content) ? (message as any).content : [])
                if (part?.attachmentId) inherited.add(String(part.attachmentId));
        for (const task of planTasks)
            for (const file of Array.isArray(task?.attachments) ? task.attachments : [])
                if (file?.sentAt && !inherited.has(String(file.attachmentId))) delete file.sentAt;
    }
    await ctx.fns.session.save({ agent });
    await ctx.fns.events.emitAgentsChanged({ agentId: agent.id, reason: "fork" });
    return agent;
}
