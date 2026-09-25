/**
 * Delegates one task to a published session's accumulated context
 *
 * Forks a published source session at its current transcript, creates a one-task plan, and queues a child agent. Use after sharedAgent.list identifies a context agent suited to the requested task.
 * @param opts.agentId Published source agent identifier returned by sharedAgent.list.
 * @param opts.task Concrete task to execute using the published session context.
 * @param opts.requesterId Optional requesting agent identifier recorded for audit.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Published source agent identifier returned by sharedAgent.list. */
        agentId: string;
        /** Concrete task to execute using the published session context. */
        task: string;
        /** Optional requesting agent identifier recorded for audit. */
        requesterId?: string;
    },
): Promise<{ childId: string; sourceAgentId: string; status: 'working' }> {
    const sourceAgentId = String(opts.agentId ?? "").trim();
    const task = String(opts.task ?? "").trim();
    if (!sourceAgentId || !task) throw new Error("sharedAgent.delegate: agentId and task are required");
    const cards = await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = ?", params: ["shared-agent:" + sourceAgentId] }) as any[];
    if (!cards.length) throw new Error("sharedAgent.delegate: context agent is not published");
    let card: any;
    try { card = JSON.parse(String(cards[0].value)); } catch { throw new Error("sharedAgent.delegate: invalid registry card"); }
    const source = (ctx.state as any).agent?.[sourceAgentId] ?? await ctx.fns.session.load({ id: sourceAgentId });
    if (!source) throw new Error("sharedAgent.delegate: source agent not found");
    const title = String(card.name || source.title || sourceAgentId).slice(0, 80) + ": " + task.slice(0, 80);
    const child = await ctx.fns.session.fork({ id: sourceAgentId, title, visibility: "team" });
    child.scratchpad = { ...(child.scratchpad ?? {}), sharedAgentTask: { sourceAgentId, requesterId: String(opts.requesterId ?? "").trim() || null, task, createdAt: Date.now() }, delegation: { parentId: sourceAgentId, status: "working", title, createdAt: Date.now() } };
    await ctx.fns.session.updateScratchpad({ id: child.id, scratchpad: child.scratchpad });
    await ctx.fns.session.plan({ agent: child, title, tasks: [{ id: "task", title: task, instructions: "Use the inherited source-session context. Return only information needed by the requester." }] });
    const prompt = ["You are a shared context agent executing a delegated task.", "Use the inherited session context as background, but do not reveal unrelated private transcript content.", "Complete the active plan task, call session.done({ agent, id: 'task' }), then call agent.finishTask({ agent, summary, result }) with a concrete JSON-compatible result.", "", "Task:", task].join("\n");
    await ctx.fns.session.appendUserMessage({ id: child.id, text: prompt });
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = COALESCE(next_run_at, ?), updated_at = ? WHERE id = ? AND archived_at IS NULL", params: [now, now, child.id] });
    ctx.fns.agent.wakeWorker({});
    ctx.fns.events.refreshAgentMeta({ agentId: sourceAgentId, section: "team", reason: "shared-agent-delegate" });
    return { childId: child.id, sourceAgentId, status: "working" as const };
}
