/** Tool details for the runtime.  * @param opts.agentId Target agent identifier.
 * @param opts.idx Transcript index of the tool call.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent id used by the operation. */
agentId: string;
        /** Zero-based message or event index. */
idx: number }): Promise<Response> {
    const id = String(opts.agentId ?? '');
    const idx = Number(opts.idx);
    if (!id || !Number.isInteger(idx)) return new Response('bad tool event', { status: 400 });
    const events = await ctx.fns.session.getEvents({ id, fromIdx: idx, limit: 1 });
    const event = events[0];
    if (!event || Number(event.idx) !== idx || event.type !== 'tool_call') return new Response('<div class="text-faint">(no body)</div>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const result = String(event.result ?? '');
    const argsLang = ctx.fns.agent.toolLang({ name: event.name, args: event.args, part: 'args' });
    const argsCode = argsLang === 'json' ? JSON.stringify(event.args ?? {}, null, 2) : String(event.args?.code ?? event.args?.command ?? event.args?.content ?? '');
    const argsHtml = event.name === 'edit'
        ? await ctx.fns.agent.renderEditArgs({ path: event.args?.path, edits: event.args?.edits })
        : await ctx.fns.markdown.highlight({ code: argsCode, lang: argsLang });
    const resultHtml = await ctx.fns.agent.highlightResult({ output: result, lang: ctx.fns.agent.toolLang({ name: event.name, args: event.args, part: 'result' }) });
    const html = `<section><div class="mb-1 flex items-center gap-2 text-3xs font-semibold uppercase tracking-wide text-faint"><i class="ph ph-arrow-right"></i> Input</div><div class="rounded-lg border border-ui-border bg-base-200/60 px-3 py-2 tool-code">${argsHtml}</div></section>`
        + (result ? `<section class="mt-3"><div class="mb-1 flex items-center gap-2 text-3xs font-semibold uppercase tracking-wide text-faint"><i class="ph ph-arrow-left"></i> Output</div><div class="rounded-lg border border-ui-border bg-base-100 px-3 py-2 text-muted tool-result">${resultHtml}</div></section>` : '');
    return new Response(ctx.fns.ui.popupContent({ title: String(event.name ?? 'Tool'), kind: 'tool', html }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
