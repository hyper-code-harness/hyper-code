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
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const id = opts.agentId;

    // Entering the chat IS reading it: move the seen watermark before the page
    // ships, so the rail (which fetches itself right after load) already sees
    // zero unread — no badge lingering for a refresh cycle. The events.html
    // poll keeps moving it while the chat stays open.
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO kv (key, value)
              SELECT 'seen-at:' || ?, COALESCE(MAX(ts), -1)::text FROM events WHERE agent_id = ?
              ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        params: [id, id],
    }).catch(() => { /* a lingering badge, not a broken page */ });
    let agent = (ctx.state as any).agent?.[id];
    if (!agent) {
        agent = (await ctx.fns.session?.load?.({ id })) ?? null;
        if (agent) {
            (ctx.state as any).agent ??= {};
            (ctx.state as any).agent[id] = agent;
        }
    }
    if (!agent) return `<div class="p-4 text-sm text-base-content/45">agent ${esc(id)} not found</div>`;

    const parent = agent.parentId ? await ctx.fns.session.load({ id: String(agent.parentId) }) : null;
    const maxIdx = await ctx.fns.session.getMaxEventIdx({ id });
    const events = await ctx.fns.session.getEvents({ id, beforeIdx: maxIdx + 1, limit: 100 });
    const inheritedCount = agent.parentId
        ? (await ctx.fns.session.getFullMessages({ id })).length - (await ctx.fns.session.getMessages({ id })).length
        : 0;

    const historyHead = events.length && Number(events[0]?.idx ?? 0) > 0
        ? `<div id="msg-head" hx-get="/agent/${encodeURIComponent(id)}/events.html?before=${Number(events[0].idx)}&limit=100" hx-trigger="load-older" hx-target="this" hx-swap="outerHTML" class="flex justify-center py-1">${ctx.fns.procs.ui.button({ action: 'load-older-messages', label: 'older messages', appearance: 'plain', class: 'rounded-full border border-ui-border bg-base-100 px-3 py-1 text-[10px] text-base-content/45 hover:text-base-content/65', attrs: { onclick: "htmx.trigger(this.parentElement, 'load-older')" } })}</div>`
        : '';
    const activeSleepForView = ctx.fns.agent.getSleepGeneration({ sleepContext: agent.sleepContext, kind: "active" });
    const eventsHtml = activeSleepForView
        ? await ctx.fns.agent.renderSleepContextHtml({ sleepContext: agent.sleepContext!, events, agentId: id })
        : await ctx.fns.agent.renderEventsHtml({ events, agentId: id });
    const lastEvent = ((await ctx.fns.procs.db.select({
        sql: 'SELECT payload FROM events WHERE agent_id = ? AND type = \'assistant\' ORDER BY idx DESC LIMIT 1',
        params: [id],
    })) as any[])[0];
    const lastUsage = lastEvent ? JSON.parse(lastEvent.payload).usage : null;
    const statusBarHtml = await ctx.fns.agent.renderStatusBar({ agentId: id, initialUsage: lastUsage });
    const stopControlHtml = await ctx.fns.agent.renderStatusBar({ agentId: id, part: 'stop' });
    const stopControlRegion = ctx.fns.ui.live({
        id: 'chat-stop-control',
        url: `/agent/${encodeURIComponent(id)}/statusbar?part=stop`,
        topic: `agent:${id}`,
        every: 5,
        swap: 'innerHTML',
        attrs: 'class="pointer-events-none absolute inset-y-0 right-1.5 z-50 flex items-center [&>button]:pointer-events-auto"',
        html: stopControlHtml,
    });

    const compactPopup = await ctx.fns.ui.inplacePopup({
        id: `compact-popover-${id}`,
        triggerHtml: '<i class="ph ph-arrows-in-line-vertical"></i>',
        triggerAttrs: 'class="px-1 text-base-content/45 hover:text-indigo-600" title="Compact context" aria-label="Compact context"',
        panelAttrs: 'aria-label="Compact context"',
        contentHtml: `<form hx-post="/agent/${encodeURIComponent(id)}/compact" hx-swap="none"><div class="text-sm font-medium">Compact context</div><textarea name="instructions" rows="3" placeholder="Optional focus instructions" class="mt-2 w-full rounded border border-ui-border bg-base-100 p-2 text-xs"></textarea>${ctx.fns.procs.ui.button({ action: 'compact-context', label: 'Compact', type: 'submit', tone: 'primary', class: 'mt-2' })}</form>`,
    });

    const modelControl = ctx.fns.ui.popup({
        method: 'agent.modelPicker',
        params: { agentId: id },
        html: ctx.fns.ui.modelLogo({ model: agent.model, bare: true }),
        attrs: `class="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-base-100/25 text-base-content/65 transition hover:bg-base-100/60 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/25" title="Change provider or model · ${esc(agent.model)}" aria-label="Change provider or model: ${esc(agent.model)}"`,
    });

    const reasoning = await ctx.fns.llm.resolveReasoningEffort({ model: agent.model, effort: agent.reasoningEffort ?? "auto" });
    const effortLabel = (agent.reasoningEffort ?? "auto") === "auto" ? `Auto · ${reasoning.applied}` : reasoning.applied;
    const effortControl = ctx.fns.ui.popup({
        method: 'agent.effortPicker',
        params: { agentId: id },
        html: `<i class="ph ph-brain" aria-hidden="true"></i><span class="hidden sm:inline capitalize">${esc(effortLabel)}</span>`,
        attrs: `class="inline-flex h-7 items-center gap-1 rounded-full border border-ui-border bg-base-100/35 px-2 text-[10px] font-medium text-base-content/60 transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary" title="Reasoning effort · ${esc(effortLabel)}" aria-label="Change reasoning effort: ${esc(effortLabel)}"`,
    });
    const workspaceDir = String(agent.workspaceDir ?? '').trim();
    const workspaceName = workspaceDir.split('/').filter(Boolean).pop() || workspaceDir;
    const workspaceControl = workspaceDir ? ctx.fns.ui.popup({
        method: 'ui.previewFile',
        params: { path: workspaceDir, mode: 'auto', title: workspaceName },
        html: `<i class="ph ph-folder-open shrink-0" aria-hidden="true"></i><span class="max-w-48 truncate">${esc(workspaceName)}</span>`,
        attrs: `class="hidden min-w-0 items-center gap-1 text-[9px] leading-none text-base-content/40 transition hover:text-primary sm:inline-flex" title="Files · ${esc(workspaceDir)}" aria-label="Open files in ${esc(workspaceDir)}"`,
    }) : '';


    const statusMode = agent.statusLineMode ?? "global";
    const statusLabel = statusMode === "global" ? "global prompt inject" : statusMode === "off" ? "prompt inject off" : (agent.statusLine ? esc(agent.statusLine) : "custom prompt inject…");
    const statusLinePopup = await ctx.fns.ui.inplacePopup({
        id: `status-line-popover-${id}`,
        triggerHtml: `<span id="status-line-label-${esc(id)}" class="min-w-0 truncate"><i class="ph ph-note-pencil mr-1"></i>${statusLabel}${statusMode === "custom" && agent.statusLine && Number(agent.statusLineEvery ?? 1) > 1 ? ` · every ${Number(agent.statusLineEvery)} turns` : ''}</span>`,
        triggerAttrs: 'class="min-w-0 max-w-full truncate text-[10px] text-base-content/45 hover:text-base-content/70" title="Edit prompt inject" aria-label="Edit prompt inject"',
        panelAttrs: 'aria-label="Edit prompt inject"',
        contentHtml: `<div class="min-w-0 space-y-3"><label class="block text-xs font-medium text-base-content/70">Mode<select form="status-line-form-${esc(id)}" name="mode" class="mt-1 block w-full rounded-lg border border-ui-input bg-base-100 px-3 py-2 text-xs"><option value="global"${statusMode === "global" ? " selected" : ""}>Global</option><option value="custom"${statusMode === "custom" ? " selected" : ""}>Custom</option><option value="off"${statusMode === "off" ? " selected" : ""}>Off</option></select></label><label class="block min-w-0 text-xs font-medium text-base-content/70">Custom text<textarea form="status-line-form-${esc(id)}" name="text" maxlength="500" rows="4" placeholder="Overrides the global Status Line…" class="mt-1 block w-full min-w-0 max-w-full box-border resize-y rounded-lg border border-ui-input bg-base-100 px-3 py-2 text-xs text-base-content">${esc(agent.statusLine ?? '')}</textarea></label><label class="block min-w-0 text-xs font-medium text-base-content/70">Custom cadence: every <input form="status-line-form-${esc(id)}" name="every" type="number" min="1" max="100" value="${Math.max(1, Number(agent.statusLineEvery ?? 1))}" class="mt-1 block w-full min-w-0 max-w-full box-border rounded-lg border border-ui-input bg-base-100 px-3 py-2 text-xs text-base-content"></label>${ctx.fns.procs.ui.button({ action: 'save-status-line', label: 'Save', type: 'submit', tone: 'primary', class: 'w-full', attrs: { form: `status-line-form-${id}` } })}</div>`,
    });

    // header names THIS agent and holds its controls, nothing more.
    return `
<header class="glass-bar absolute inset-x-0 top-0 z-40 mx-auto mt-2 flex h-11 w-[calc(100%-2rem)] max-w-3xl shrink-0 items-center gap-2.5 overflow-visible rounded-[22px] border border-ui-border pl-2 pr-5 text-xs text-base-content/70">
  ${modelControl}
  <span class="flex min-w-0 flex-col">
    <span class="truncate font-mono font-medium leading-4 text-base-content/80">${esc(String(agent.title ?? id).slice(0, 40) || id)} <span class="text-base-content/45">(${esc(id)})</span></span>
    ${workspaceControl}
  </span>
   ${agent.parentId ? `<a href="/agent/${encodeURIComponent(String(agent.parentId))}" class="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-amber-700 hover:bg-amber-100 hover:text-amber-900" title="forked from ${esc(parent?.title || agent.parentId)} · inherited ${inheritedCount} msgs" aria-label="Back to parent agent ${esc(parent?.title || agent.parentId)}"><i class="ph ph-arrow-bend-up-left mr-0.5"></i>${esc(String(parent?.title || agent.parentId).slice(0, 24))}</a>` : ""}
  ${statusBarHtml}
  <span class="ml-auto flex items-center gap-1">
    ${effortControl}
    ${compactPopup}

    ${ctx.fns.ui.popup({ method: 'agent.initialPromptPopup', params: { agentId: id }, html: '<i class="ph ph-scroll" aria-hidden="true"></i>', attrs: 'title="Initial prompt" aria-label="Initial prompt" class="px-1 text-base-content/45 hover:text-indigo-600"' })}

    <a href="/shared-agents?from=${encodeURIComponent(id)}" title="Publish or use Shared Agents" aria-label="Shared Agents" class="px-1 text-base-content/45 hover:text-indigo-600"><i class="ph ph-users-three" aria-hidden="true"></i></a>

    <form method="POST" action="/agent/${encodeURIComponent(id)}/fork" hx-boost="false" class="inline">
      ${ctx.fns.procs.ui.button({ action: 'fork', entity: 'agent', id, html: '<i class="ph ph-git-fork" aria-hidden="true"></i>', type: 'submit', appearance: 'plain', title: 'fork and open', ariaLabel: 'Fork and open agent', class: 'px-1 text-base-content/45 transition hover:text-indigo-600' })}
    </form>

    <a href="/agent/${encodeURIComponent(id)}" hx-boost="false" title="agent page" class="px-1 text-base-content/45 hover:text-base-content/70">ⓘ</a>
    <span class="mx-1 h-5 w-px bg-ui-border" aria-hidden="true"></span>
    <form method="POST" action="/agent/${encodeURIComponent(id)}/archive" hx-boost="false" class="inline">
      ${ctx.fns.procs.ui.button({ action: 'archive', entity: 'agent', id, html: '<i class="ph ph-archive"></i>', type: 'submit', appearance: 'plain', title: 'archive — hides from the rail, keeps the transcript', class: 'rounded px-1 text-base-content/45 hover:bg-red-50 hover:text-red-600' })}
    </form>
    <form method="POST" action="/agent/${encodeURIComponent(id)}/delete" hx-boost="false" class="inline" onsubmit="return confirm('delete ${esc(id)}? The transcript goes with it.')">
      ${ctx.fns.procs.ui.button({ action: 'delete', entity: 'agent', id, html: '<i class="ph ph-trash"></i>', type: 'submit', appearance: 'plain', title: 'delete', class: 'rounded px-1 text-base-content/45 hover:bg-red-50 hover:text-red-600' })}
    </form>
  </span>
</header>
<div id="messages" data-agent-id="${esc(id)}" data-inherited-count="${inheritedCount}" style="overflow-anchor:none" class="dot-grid-surface chat-dot-grid flex-1 overflow-y-auto px-3 py-3 space-y-2">${historyHead}${eventsHtml}
${agent.sleepContext?.active === true
  ? `<div id="msg-tail" hx-get="/agent/${encodeURIComponent(id)}/events.html?offset=${maxIdx + 1}&compact=1" hx-trigger="load" hx-target="this" hx-swap="outerHTML"></div>`
  : `<div id="msg-tail" hx-get="/agent/${encodeURIComponent(id)}/events.html?offset=${maxIdx + 1}" hx-trigger="load" hx-target="this" hx-swap="outerHTML"></div>`}
</div>
${await ctx.fns.ui.chatComposer({ action: `/agent/${encodeURIComponent(id)}?debounceSeconds=0.1`, controlsHtml: stopControlRegion, statusHtml: statusLinePopup })}

<form id="status-line-form-${esc(id)}" hx-post="/agent/${encodeURIComponent(id)}/status-line" hx-target="#status-line-label-${esc(id)}" hx-swap="innerHTML" hx-on::after-request="if(event.detail.successful) document.getElementById('status-line-popover-${esc(id)}')?.hidePopover()"></form>

`;
}
