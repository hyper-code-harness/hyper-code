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
    if (!event || Number(event.idx) !== idx || event.type !== 'tool_call') return new Response(ctx.fns.w.empty({ title: 'No details for this call' }), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    const result = String(event.result ?? '');
    const argsLang = ctx.fns.agent.toolLang({ name: event.name, args: event.args, part: 'args' });
    const argsCode = argsLang === 'json' ? JSON.stringify(event.args ?? {}, null, 2) : String(event.args?.code ?? event.args?.command ?? event.args?.content ?? '');
    const w = ctx.fns.w;
    const resultLang = ctx.fns.agent.toolLang({ name: event.name, args: event.args, part: 'result' });
    const argsHtml = event.name === 'edit'
        ? await ctx.fns.agent.renderEditArgs({ path: event.args?.path, edits: event.args?.edits })
        : await w.code({ code: argsCode, lang: argsLang });
    // JSON output reads better pretty-printed; anything else is shown as it came.
    const trimmed = result.trim();
    let pretty: string | null = null;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) { try { pretty = JSON.stringify(JSON.parse(trimmed), null, 2); } catch { pretty = null; } }
    const resultHtml = await w.code({ code: pretty ?? result, lang: pretty ? 'json' : resultLang || 'text' });
    const part = (icon: string, title: string, inner: string) => w.box({
        body: w.box({ body: w.icon({ name: icon, size: 12 }) + w.escape({ text: title }), mix: { layout: 'row', gap: 's2', caption: true } }) + inner,
        mix: { layout: 'stack', gap: 's1' }, tag: 'section',
    });
    const html = w.box({ body: part('arrow-right', 'Input', argsHtml) + (result ? part('arrow-left', 'Output', resultHtml) : ''), mix: { layout: 'stack', gap: 's3' } });
    return new Response(ctx.fns.ui.popupContent({ title: String(event.name ?? 'Tool'), kind: 'tool', html }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
