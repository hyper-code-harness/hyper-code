/** Performs the ui.createAgent runtime operation. */
/**
 * Create an agent and optionally open or seed its conversation.
 * @param opts.model Model identifier.
 * @param opts.systemPrompt System prompt for the new agent.
 * @param opts.open Whether to open the target agent after the operation.
 * @param opts.startText Initial user message for the new agent.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Model identifier to use. */ model?: string;
        /** Value used for the system prompt option. */ systemPrompt?: string;
        /** Whether to open the agent after sending. */ open?: boolean;
        /** Value used for the start text option. */ startText?: string } = {},
) {
    // Priority: explicit opts.model > declared setting (DB → env → default).
    const fromSettings = await ctx.fns?.settings?.getString?.({
        module: 'llm', scopeType: 'global', key: 'defaultModel',
    });
    const model = (opts.model ?? fromSettings ?? 'claude-code:claude-opus-5').trim();
    const agent = await ctx.fns.agent.start({
        model,
        systemPrompt: opts.systemPrompt ?? '',
    });
    try { await ctx.fns.session?.save?.({ agent }); } catch (e: any) { console.error('[session.save]', e?.message); }
    if (opts.open !== false) ctx.fns.procs.events.emit({ event: { type: 'ui.navigate', path: '/agent/' + encodeURIComponent(agent.id) } });
    if (opts.startText?.trim()) {
        const text = opts.startText.trim();
        const offset = agent.events.length;
        agent.events.push({ type: 'user', text });
        agent.isStreaming = true;
        queueMicrotask(async () => {
            try { await ctx.fns.agent.run({ agent, userText: text }); }
            catch (e: any) { agent.events.push({ type: 'error', error: e.message }); }
            finally { agent.isStreaming = false; }
        });
        return { id: agent.id, model: agent.model, opened: opts.open !== false, started: true, offset };
    }
    return { id: agent.id, model: agent.model, opened: opts.open !== false, started: false };
}
