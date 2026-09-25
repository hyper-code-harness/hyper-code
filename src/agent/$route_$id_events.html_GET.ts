// Short-fetch HTML stream of events for an agent.
// Returns rendered events at offset N + a self-replacing tail div.
//
// No long-poll: #msg-tail is a standard live region on `agent:<id>`.
// The shared topic-filtered SSE client triggers its HTMX refresh, while a
// 30-second watchdog repairs a notification missed during disconnection.
/** Handles the id events.html get HTTP route.  * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request;
        /** Values bound to the operation. */
params: Record<string, string> }) {
    const id = opts.params.id!;
    const url = new URL(opts.req.url);
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0') || 0);

    const beforeRaw = url.searchParams.get('before');
    const before = beforeRaw == null ? null : Math.max(0, Number(beforeRaw) || 0);
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? '100') || 100));
    const compact = url.searchParams.get('compact') === '1';
    const agentRow = ((await ctx.fns.procs.db.select({ sql: 'SELECT id FROM agents WHERE id = ?', params: [id] })) as any[])[0];
    if (!agentRow) return new Response('not found', { status: 404 });

    // `before` is the upward history pager. It returns a new head sentinel plus
    // the page, while the ordinary `offset` mode remains the live bottom tail.
    if (before != null) {
        const events = await ctx.fns.session.getEvents({ id, beforeIdx: before, limit });
        const eventsHtml = await ctx.fns.agent.renderEventsHtml({ events, agentId: id });
        const firstIdx = events.length ? Number(events[0]?.idx ?? 0) : 0;
        const head = firstIdx > 0
            ? `<div id="msg-head" hx-get="/agent/${encodeURIComponent(id)}/events.html?before=${firstIdx}&limit=${limit}" hx-trigger="load-older" hx-target="this" hx-swap="outerHTML" class="flex justify-center py-1">${ctx.fns.procs.ui.button({ action: 'load-older-messages', label: 'older messages', size: 'xs', class: 'rounded-full text-3xs', attrs: { onclick: "htmx.trigger(this.parentElement, 'load-older')" } })}</div>`
            : '';
        return new Response(head + eventsHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    const maxIdx = await ctx.fns.session.getMaxEventIdx({ id });
    const events = await ctx.fns.session.getEvents({ id, fromIdx: offset });
    const eventsHtml = await ctx.fns.agent.renderEventsHtml({ events, agentId: id });

    // This poll only runs while the chat is on screen, so it IS the reader:
    // move the event watermark past every user-facing completion signal.
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO kv (key, value)
              SELECT 'seen-at:' || ?, COALESCE(MAX(ts), -1)::text FROM events WHERE agent_id = ?
              ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        params: [id, id],
    }).catch(() => { /* a missed mark is a badge that lingers one poll */ });

    const lastAssistant = [...events].reverse().find((ev: any) => ev?.type === 'assistant');
    const usageOob = lastAssistant?.usage
        ? `<span id="context-usage" hx-swap-oob="outerHTML" class="text-xs text-subtle font-mono">${formatUsage(lastAssistant.usage)}</span>`
        : '';

    const nextOffset = maxIdx + 1;
    const tailUrl = `/agent/${encodeURIComponent(id)}/events.html?offset=${nextOffset}${compact ? '&compact=1' : ''}`;
    // A standard live region on this agent's topic. The offset remains in the
    // URL because it is transcript paging state, not SSE protocol state.
    const tail = ctx.fns.ui.live({
        id: 'msg-tail',
        url: tailUrl,
        topic: `agent:${id}`,
        every: 30,
    });

    return new Response(eventsHtml + '\n' + tail + usageOob, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}

function fmtTok(n: any): string {
    if (n == null) return '—';
    const num = Number(n);
    if (num < 1000) return String(num);
    return (Math.round(num / 100) / 10).toString().replace(/\.0$/, '') + 'k';
}

function formatUsage(usage: any): string {
    if (!usage) return 'ctx: —';
    const inTok = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens;
    const total = usage.total_tokens ?? usage.totalTokens;
    if (inTok != null && total != null) return 'ctx: ' + fmtTok(inTok) + ' · total: ' + fmtTok(total);
    if (inTok != null) return 'ctx: ' + fmtTok(inTok);
    if (total != null) return 'ctx total: ' + fmtTok(total);
    return 'ctx: —';
}
