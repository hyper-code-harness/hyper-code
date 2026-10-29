/**
 * Create an agent and optionally open or seed its conversation.
 * @param opts.model Model identifier.
 * @param opts.systemPrompt System prompt for the new agent.
 * @param opts.systemPromptName Name of the base system prompt (agent.systemPrompts).
 * @param opts.systemPromptCore A one-off base system prompt text used instead of a named one.
 * @param opts.open Whether to open the target agent after the operation.
 * @param opts.startText Initial user message for the new agent.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Model identifier to use. */ model?: string;
        /** Additional system instructions for the new conversation. */ systemPrompt?: string;
        /** Name of the base system prompt (agent.systemPrompts). */ systemPromptName?: string;
        /** A one-off base system prompt text used instead of a named one. */ systemPromptCore?: string;
        /** Navigate to the new conversation. @default true */ open?: boolean;
        /** Initial user text; a nonblank value starts a background turn. */ startText?: string } = {},
): Promise<{ id: string; model: string; opened: boolean; started: boolean; offset?: number }> {
    // Priority: explicit opts.model > declared setting (DB → env → default).
    const fromSettings = await ctx.fns?.settings?.getString?.({
        module: 'llm', scopeType: 'global', key: 'defaultModel',
    });
    const model = (opts.model ?? fromSettings ?? 'claude-code:claude-opus-5').trim();
    const agent = await ctx.fns.agent.start({
        model,
        systemPrompt: opts.systemPrompt ?? '',
        systemPromptName: opts.systemPromptName,
        systemPromptCore: opts.systemPromptCore,
    });
    try { await ctx.fns.session?.save?.({ agent }); } catch (e: any) { console.error('[session.save]', e?.message); }
    if (opts.open !== false) ctx.fns.procs.events.emit({ event: { type: 'ui.navigate', path: '/agent/' + encodeURIComponent(agent.id) } });
    if (opts.startText?.trim()) {
        const text = opts.startText.trim();
        const offset = agent.events.length;
        await ctx.fns.session.appendEvent({ id: agent.id, event: { type: 'user', text } });
        await ctx.fns.session.syncAgentState({ agent });
        agent.isStreaming = true;
        queueMicrotask(async () => {
            try { await ctx.fns.agent.run({ agent, userText: text }); }
            catch (e: any) {
                await ctx.fns.session.appendEvent({ id: agent.id, event: { type: 'error', error: e.message } });
                await ctx.fns.session.syncAgentState({ agent });
            }
            finally { agent.isStreaming = false; }
        });
        return { id: agent.id, model: agent.model, opened: opts.open !== false, started: true, offset };
    }
    return { id: agent.id, model: agent.model, opened: opts.open !== false, started: false };
}
