/**
 * Ask a follow-up question to an existing delegated child agent
 *
 * Resumes a direct child agent on its preserved transcript and returns its concise answer while also steering that answer into the parent. Use when a delegation summary lacks detail and repeating the original investigation would waste context.
 * @param opts.agent Parent agent that owns the delegated child.
 * @param opts.member Direct child agent ID returned by agent.delegate.
 * @param opts.question Focused follow-up question for the child.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Parent agent that owns the delegated child. */
        agent: types.agent.Agent;
        /** Direct child agent ID returned by agent.delegate. */
        member: string;
        /** Focused follow-up question for the child. */
        question: string;
    },
): Promise<{ member: string; answer: string }> {
    const member = String(opts.member ?? "").trim();
    const question = String(opts.question ?? "").trim();
    if (!member || !question) throw new Error("ask: member and question are required");
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT parent_id FROM agents WHERE id = ? AND archived_at IS NULL", params: [member] })) as any[];
    if (!rows[0] || String(rows[0].parent_id ?? "") !== opts.agent.id) throw new Error("ask: member is not a direct child of this agent");
    const now = Date.now();
    const claimed = await ctx.fns.procs.db.select({
        sql: "UPDATE agents SET run_state = 'running', run_started_at = ?, updated_at = ? WHERE id = ? AND parent_id = ? AND archived_at IS NULL AND run_state = 'idle' RETURNING id",
        params: [now, now, member, opts.agent.id],
    }) as any[];
    if (!claimed.length) throw new Error("ask: member is busy");
    const child = (ctx.state as any).agent?.[member] ?? await ctx.fns.session.load({ id: member });
    if (!child) throw new Error("ask: member not found: " + member);
    let answer = "";
    try {
        const userText = ["Parent follow-up question:", question, "", "Answer concisely from your preserved work. Do not call finishTask again."].join("\n");
        await ctx.fns.session.appendUserMessage({ id: child.id, text: userText, author: "agent:" + opts.agent.id, eventExtra: { agentMessage: { from: opts.agent.id, title: String(opts.agent.title ?? ""), body: question } } });
        await ctx.fns.session.syncAgentState({ agent: child });
        const response = await ctx.fns.agent.run({ agent: child, userText, userMessageAlreadyAppended: true });
        answer = String((response as any)?.text ?? "").trim();
        if (answer) await ctx.fns.agent.steer({ from: child, event: "answer", summary: answer });
        return { member, answer };
    } finally {
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET run_state = 'idle', run_started_at = NULL, updated_at = ? WHERE id = ?", params: [Date.now(), member] });
    }
}
