/** Render the agent's initial/full system prompt in the permanent popup. */
export default async function (ctx: Context, _session: Session | null, opts: { agentId: string }): Promise<Response> {
    const id = String(opts.agentId ?? '');
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response('agent not found', { status: 404 });
    const prompt = await ctx.fns.agent.fullSystemPrompt({ agent });
    const html = await ctx.fns.markdown.render({ source: prompt });
    return new Response(ctx.fns.ui.popupContent({
        title: `Initial prompt · ${agent.title || id}`,
        kind: 'initial-prompt',
        html: `<div class="mb-3 text-2xs text-faint">${prompt.length.toLocaleString()} chars · ${Math.ceil(prompt.length / 4).toLocaleString()} estimated tokens</div><article class="prose prose-sm max-w-none break-words text-base-content">${html}</article>`,
    }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
