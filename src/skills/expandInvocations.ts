// `/name` or `/pack:name` at the very start of a message, followed by a space or the end. `/usr/bin` and `5/8` do not match.
const GESTURE = /^\/([a-z0-9]+(?:-[a-z0-9]+)*(?::[a-z0-9]+(?:-[a-z0-9]+)*)?)(?=\s|$)([\s\S]*)$/;

/**
 * Expands `/name` typed by a person at the start of a chat message into the skill's instructions, as a separate transcript row
 *
 * Call from agent.run before a model request. Looks at the agent's own human messages that were not looked at yet
 * (never at messages written by another agent, which must not be able to start a skill), and for each that begins
 * with the name of a skill a person may start, appends one cursor-excluded `skill_invocation` row with the same
 * `<skill_content>` block the `skill` tool returns, plus a `skill_invocation` event for the chat. The person's message
 * stays exactly as typed; the rest of it is the argument. An unknown name is ordinary text. Does nothing for an agent
 * without the `skill` tool, and nothing while the transcript ends with an unanswered tool call.
 * @param opts.agent Live agent whose transcript is expanded.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Live agent whose transcript is expanded. */
    agent: types.agent.Agent;
}): Promise<{ expanded: string[] }> {
    const agent = opts.agent;
    if (!ctx.fns.skills.enabledFor({ agent })) return { expanded: [] };
    const tail: any = (agent.messages ?? [])[(agent.messages ?? []).length - 1];
    if (tail?.role === "assistant" && tail?.tool_calls?.length) return { expanded: [] };

    const scanned = (agent.scratchpad as any)?.skills?.scannedIdx;
    // First time for this agent: only what came after its last answer, never the whole history.
    const from = typeof scanned === "number" ? scanned : Number(((await ctx.fns.procs.db.select({ sql: "SELECT COALESCE(MAX(idx), -1) AS i FROM messages WHERE agent_id = ? AND role = 'assistant'", params: [agent.id] })) as any[])[0]?.i ?? -1);
    const rows = await ctx.fns.procs.db.select({
        sql: "SELECT idx, content, author, message_type FROM messages WHERE agent_id = ? AND idx > ? AND role = 'user' AND excluded_from_cursor = 0 ORDER BY idx",
        params: [agent.id, from],
    }) as any[];
    if (!rows.length) return { expanded: [] };

    const expanded: string[] = [];
    for (const row of rows) {
        if (row.message_type != null && row.message_type !== "message") continue;
        if (String(row.author ?? "").startsWith("agent:")) continue;
        const match = GESTURE.exec(String(row.content ?? "").trimStart());
        if (!match || expanded.includes(match[1]!)) continue;
        const result = await ctx.fns.skills.use({ name: match[1]!, via: "user", args: (match[2] ?? "").trim(), messageIdx: Number(row.idx), agent });
        if (result.isError || !result.skill) continue;
        const message = await ctx.fns.session.appendMessage({ id: agent.id, message: {
            role: "user",
            content: `The person started the skill ${result.skill} with /${match[1]}. It is loaded below — follow it for their message above. When it tells you to use another skill, load that one with skill({ name: "<that skill>" }).\n\n${result.output}`,
            excluded_from_cursor: true,
            message_type: "skill_invocation",
        } });
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: "skill_invocation", skill: result.skill, typed: match[1], chars: result.output.length, messageIdx: message.idx } });
        expanded.push(match[1]!);
    }
    const last = Number(rows[rows.length - 1].idx);
    agent.scratchpad ??= {};
    (agent.scratchpad as any).skills = { ...((agent.scratchpad as any).skills ?? {}), scannedIdx: last };
    await ctx.fns.session.mutateScratchpad({ id: agent.id, mutate: (scratchpad: Record<string, any>) => { scratchpad.skills = { ...(scratchpad.skills ?? {}), scannedIdx: last }; } })
        .catch((error: any) => ctx.fns.procs.log.warn({ event: "skills.expand.scratchpad-failed", msg: String(error?.message ?? error), agentId: agent.id }));
    if (expanded.length) await ctx.fns.session.syncAgentState({ agent });
    return { expanded };
}
