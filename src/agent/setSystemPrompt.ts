/**
 * Switches a chat to another named system prompt from its next turn.
 *
 * The name must be one agent.systemPrompts lists for this chat (built-in full or lean, or a saved one of its person
 * or project). Clears a one-off base given at creation. The provider's prompt cache restarts once, because the
 * prefix of every request changes. Remembers the pick as the person's last choice for the New agent form.
 * @param opts.id Agent to switch.
 * @param opts.name Name of the system prompt.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** Agent to switch. */
    id: string;
    /** Name of the system prompt. */
    name: string;
}): Promise<{ id: string; name: string }> {
    const name = String(opts.name ?? "").trim();
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ? AND archived_at IS NULL", params: [opts.id] })) as any[])[0];
    if (!row) throw new Error(`agent not found: ${opts.id}`);
    const found = (await ctx.fns.agent.systemPrompts({ agentId: opts.id, name }))[0];
    if (!found) throw new Error(`agent.setSystemPrompt: no system prompt "${name}" for this chat`);
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET system_prompt_name = ?, system_prompt_core = '', updated_at = ? WHERE id = ?", params: [name, Date.now(), opts.id] });
    const live = (ctx.state as any).agent?.[opts.id];
    if (live) { live.systemPromptName = name; live.systemPromptCore = ""; }
    const userId = (session as any)?.user?.id ?? row.created_by;
    if (userId) await ctx.fns.agent.rememberSystemPrompt({ userId, name });
    ctx.fns.events.emitAgentsChanged({ agentId: opts.id, reason: "system-prompt" });
    return { id: opts.id, name };
}
