/**
 * Resume a paused plan: clears the pause and its reason and restarts the active task's clock, so automatic plan
 * continuation works again. agent.run calls it when what the plan waited for arrives (a new message from the
 * person, or for a pause the agent set itself also a peer message, a team update, a finished job or a trigger);
 * call it yourself to take a paused plan up again without waiting for one. Returns resumed:false when there is no
 * paused plan.
 * @param opts.agent Live agent whose plan is resumed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Live agent whose plan is resumed. */
        agent?: types.agent.Agent;
    },
): Promise<{ resumed: boolean }> {
    const agent = opts.agent ?? (session as any)?.agent;
    if (!agent?.id) throw new Error("resumePlan: agent is required");
    const updated: any = await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>, now: number) => {
        const plan = scratchpad.plan;
        if (!plan?.pausedAt) return { resumed: false };
        plan.pausedAt = null;
        delete plan.pausedBy;
        delete plan.pauseReason;
        plan.updatedAt = now;
        const active = Array.isArray(plan.tasks) ? plan.tasks.find((task: any) => task.status === "active") : null;
        if (active && !active.activeSince) active.activeSince = now;
        return { resumed: true };
    } });
    agent.scratchpad = updated.scratchpad;
    if (updated.result.resumed) ctx.fns.events?.refreshAgentMeta?.({ agentId: agent.id, section: "plan", reason: "plan-resumed" });
    return updated.result;
}
