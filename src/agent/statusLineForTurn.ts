/** Status line for turn for the runtime.  * @param opts.agent Agent whose state is read or updated.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Live agent instance to operate on. */
    agent: types.agent.Agent },
): Promise<string> {
    const agent = opts.agent;
    const mode = agent.statusLineMode ?? "global";
    const globalText = mode === "global" ? String(await ctx.fns.settings.getString({ module: "agent", scopeType: "global", key: "globalStatusLine", fallback: "" }) ?? "").trim() : "";
    const userText = mode === "custom" ? String(agent.statusLine ?? "").trim() : mode === "global" ? globalText : "";
    const every = mode === "global" ? 1 : Math.max(1, Number(agent.statusLineEvery ?? 1));
    const row = ((await ctx.fns.procs.db.select({
        sql: "SELECT COUNT(*) AS n FROM messages WHERE agent_id = ? AND role = 'user' AND excluded_from_cursor = 0",
        params: [agent.id],
    })) as any[])[0];
    const parts: string[] = [];
    const turn = Number(row?.n ?? 0);
    if (userText && turn > 0 && turn % every === 0) parts.push(`User status line: ${userText}`);
    return parts.join("\n");
}
