// Keeps the chat's active goal in front of the agent. The goal first arrives as a `goal_activation` message
// (agent.setGoal); a compaction can drop that message, after which only the checker's feedback named the goal.
// This block is part of the world state, so it is sent once and again when it changes or was compacted away.
/** Answers agent.promptAugment with the agent's active goal and the checker's last verdict; "" when no goal is active.
 * @param opts.agentId Agent whose turn is being prepared.
 * @param opts.text Latest user message, verbatim.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose turn is being prepared. */
    agentId: string;
    /** Latest user message, verbatim. */
    text: string;
}): Promise<string> {
    const agent = (ctx.state as any).agent?.[opts.agentId] ?? await ctx.fns.session.load({ id: opts.agentId });
    const goal: any = agent?.goal;
    const statement = String(goal?.statement ?? "").trim();
    if (!goal?.enabled || !statement) return "";
    const last = Array.isArray(goal.checks) ? goal.checks[goal.checks.length - 1] : null;
    const verdict = last?.status && last.status !== "achieved"
        ? `\nLast check: ${String(last.status).replace(/_/g, " ")} — ${String(last.reason ?? "").slice(0, 300)}`
        : "";
    return `## Goal\n\nThe person set a goal for this chat; a checker verifies it before you may stop, up to ${Number(goal.maxIterations ?? 3)} times a turn:\n${statement}${verdict}`;
}
