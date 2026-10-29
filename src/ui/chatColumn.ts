// The agent chat as ONE self-contained column (header + transcript + composer),
// rendered by the layout into the left panel — the workspace pattern: the chat
// is harness, pages on the right are product. Extracted from the old
// /agent/:id page; the long-poll (#msg-tail), statusbar poll and chat.js
// behaviors are unchanged.
/** Performs the ui.chatColumn runtime operation. */
/**
 * The agent chat as ONE self-contained column (header + transcript + composer),.
 * @param opts.agentId Target agent identifier.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Identifier of the agent whose scoped setting is used. */ agentId: string }): Promise<string> {
    const esc = (s: any) => ctx.fns.w.escape({ text: s });
    const id = opts.agentId;

    // Entering the chat IS reading it: move the seen watermark before the page
    // ships, so the rail (which fetches itself right after load) already sees
    // zero unread — no badge lingering for a refresh cycle. The events.html
    // poll keeps moving it while the chat stays open.
    await ctx.fns.auth.markSeen({ agentId: id }).catch(() => { /* a lingering badge, not a broken page */ });
    let agent = (ctx.state as any).agent?.[id];
    if (!agent) {
        agent = (await ctx.fns.session?.load?.({ id })) ?? null;
        if (agent) {
            (ctx.state as any).agent ??= {};
            (ctx.state as any).agent[id] = agent;
        }
    }
    if (!agent) return `<div class="p-4 text-sm text-faint">agent ${esc(id)} not found</div>`;

    const maxIdx = await ctx.fns.session.getMaxEventIdx({ id });
    const events = await ctx.fns.session.getEvents({ id, beforeIdx: maxIdx + 1, limit: 100 });

    const historyHead = events.length && Number(events[0]?.idx ?? 0) > 0
        ? `<div id="msg-head" hx-get="/agent/${encodeURIComponent(id)}/events.html?before=${Number(events[0].idx)}&limit=100" hx-trigger="load-older" hx-target="this" hx-swap="outerHTML" class="flex justify-center py-1">${ctx.fns.w.pressable({ html: ctx.fns.w.escape({ text: 'older messages' }), marks: { action: 'load-older-messages' }, attrs: { onclick: "htmx.trigger(this.parentElement, 'load-older')" }, class: 'rounded-full border border-ui-border bg-base-100 px-3 py-1 text-3xs text-faint hover:text-muted' })}</div>`
        : '';
    const activeSleepForView = ctx.fns.agent.getSleepGeneration({ sleepContext: agent.sleepContext, kind: "active" });
    const eventsHtml = activeSleepForView
        ? await ctx.fns.agent.renderSleepContextHtml({ sleepContext: agent.sleepContext!, events, agentId: id })
        : await ctx.fns.agent.renderEventsHtml({ events, agentId: id, live: true });
    const stopControlHtml = await ctx.fns.agent.renderStatusBar({ agentId: id, part: 'stop' });
    const stopControlRegion = ctx.fns.ui.live({
        id: 'chat-stop-control',
        url: `/agent/${encodeURIComponent(id)}/statusbar?part=stop`,
        topic: `agent:${id}`,
        // The agent topic signals start/stop; the interval is only a watchdog.
        every: 30,
        swap: 'innerHTML',
        attrs: 'class="w-composer-send"',
        html: stopControlHtml,
    });
    // Background jobs of this chat: a badge before the context ring while any runs (also after the turn ended); a click opens
    // the list with logs and Stop (jobs.popup). jobs.start / jobs.finish refresh the agent topic.
    const jobsRegion = ctx.fns.ui.live({
        id: 'chat-jobs-badge',
        url: `/jobs/${encodeURIComponent(id)}/badge`,
        topic: `agent:${id}`,
        every: 30,
        swap: 'innerHTML',
        attrs: 'class="w-composer-jobs"',
        html: await ctx.fns.jobs.badge({ agentId: id }),
    });
    // Subagents of this chat (agent.delegate children still working): a robot badge beside the jobs one; a click
    // opens agent.teamPopup. events.refreshAgentMeta({ section: "team" }) refreshes the agent topic.
    const teamRegion = ctx.fns.ui.live({
        id: 'chat-team-badge',
        url: `/agent/${encodeURIComponent(id)}/team-badge`,
        topic: `agent:${id}`,
        every: 30,
        swap: 'innerHTML',
        attrs: 'class="w-composer-jobs"',
        html: await ctx.fns.agent.teamBadge({ agentId: id }),
    });

    const inject = await ctx.fns.chat.promptInject({ agentId: id });

    // The header — avatar, name, $chatbadge_ / $chatbutton_ parts and the ⋯ panel of $chatcard_ — is chat.header.
    const view = await ctx.fns.chat.buildRenderContext({ agentId: id });
    const headerHtml = view ? await ctx.fns.chat.header({ context: view }) : '';

    // header names THIS agent and holds its controls, nothing more.
    return `
${headerHtml}
<div id="messages" data-agent-id="${esc(id)}" data-inherited-count="${view?.inheritedCount ?? 0}" style="overflow-anchor:none" class="dot-grid-surface chat-dot-grid flex-1 overflow-y-auto px-3 py-3 space-y-2">${historyHead}${eventsHtml}
${agent.sleepContext?.active === true
  ? `<div id="msg-tail" hx-get="/agent/${encodeURIComponent(id)}/events.html?offset=${maxIdx + 1}&compact=1" hx-trigger="load" hx-target="this" hx-swap="outerHTML"></div>`
  : `<div id="msg-tail" hx-get="/agent/${encodeURIComponent(id)}/events.html?offset=${maxIdx + 1}" hx-trigger="load" hx-target="this" hx-swap="outerHTML"></div>`}

</div>
${await ctx.fns.ui.chatComposer({
  action: `/agent/${encodeURIComponent(id)}?debounceSeconds=0.1`,
  controlsHtml: stopControlRegion,
  // The prompt inject takes a line above the text only when it differs from the instance default;
  // otherwise it is a quiet icon among the meters.
  aboveHtml: inject.mode === "global" ? "" : inject.trigger,
  statusHtml: inject.mode === "global" ? inject.trigger : "",
  toolsHtml: await ctx.fns.chat.modelChip({ agentId: id }),
  metersHtml: teamRegion + jobsRegion + ctx.fns.ui.live({ id: 'chat-context-ring', url: `/chat/${encodeURIComponent(id)}/ring`, topic: `agent:${id}`, every: 60, swap: 'innerHTML', attrs: 'class="w-composer-meters"', html: await ctx.fns.chat.contextRing({ agentId: id }) }),
})}

${inject.panel}

`;
}
