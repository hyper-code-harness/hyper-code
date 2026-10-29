/**
 * Returns the base system prompt text of an agent and the name it came from.
 *
 * The base is the replaceable part of the system prompt (see agent.systemPrompts): a one-off text given at
 * creation (`systemPromptCore`) wins, then the chat's chosen name, then the instance default setting
 * agent.defaultSystemPrompt, then `full`. An unknown or deleted name falls back to `full` and says so in `missing`,
 * so a chat never loses its prompt. fullSystemPrompt builds on this; use it to show which base a chat runs on.
 * @param opts.agent Agent whose base prompt is resolved.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose base prompt is resolved. */
    agent: types.agent.Agent;
}): Promise<{ name: string; text: string; source: "builtin" | "user" | "project" | "custom"; missing?: string }> {
    const agent = opts.agent;
    const custom = String(agent.systemPromptCore ?? "");
    if (custom.trim()) return { name: "custom", text: custom, source: "custom" };
    const wanted = String(agent.systemPromptName ?? "").trim()
        || String((await ctx.fns.settings.getString({ module: "agent", scopeType: "global", key: "defaultSystemPrompt" }).catch(() => "")) ?? "").trim()
        || "full";
    // An agent that is not saved yet (a test, a draft) has no row: look the name up by its creator only.
    const found = (await ctx.fns.agent.systemPrompts({ agentId: agent.id, userId: agent.createdBy ?? null, name: wanted }))[0];
    if (found) return { name: found.name, text: found.text, source: found.source };
    const full = (await ctx.fns.agent.systemPrompts({ name: "full" }))[0]!;
    return { name: "full", text: full.text, source: "builtin", missing: wanted };
}
