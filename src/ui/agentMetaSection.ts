// The right inspector panel is five independent sections. Each one renders
// here, ONCE, so the full-page shell (ui.agentMetaPanel) and the pushed
// single-section redraw (ui.agentMetaSection) can never drift apart.
//
// A section's <details> wrapper — including its badge — is part of the
// fragment. The static page shell never carries state, so a redraw replacing
// the whole <details> can only lose the "open" attribute; the client restores
// it around the swap (see $script_meta.js).
/** Renders one section of the agent inspector panel. */
/**
 * Render one section of the agent meta panel as a standalone fragment.
 *
 * Shared by the initial panel render and by the per-section RPC redraw:
 * ui.agentMetaPanel composes all five, and the client swaps exactly one when
 * the server pushes ui.metaSection for it.
 *
 * @param opts.agent Agent whose panel is rendered.
 * @param opts.section Which section to render: goal, automation, wake, team or plan.
 * @param opts.team Direct delegated children, for the team section.
 * @param opts.archivedTeam Archived delegated children, for the team section.
 * @param opts.models Models grouped by provider, for the parked-agent switcher.
 * @param opts.accounts Credential accounts with quota, for the parked-agent switcher.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose panel is rendered. */
    agent: types.agent.Agent;
    /** Section to render. */
    section: "goal" | "knowledge" | "automation" | "schedules" | "wake" | "team" | "plan";
    /** Durable recurring prompt schedules for this agent. */
    schedules?: any[];
    /** Direct delegated children with their existing plans. */
    team?: Array<{ id: string; title: string; runState: string; status: string; plan: any; summary: string | null; updatedAt: number; archivedAt?: number | null }>;
    /** Archived delegated children displayed by the Team filter. */
    archivedTeam?: Array<{ id: string; title: string; runState: string; status: string; plan: any; summary: string | null; updatedAt: number; archivedAt?: number | null }>;
    /** Models grouped by provider, used by the parked-agent switcher. */
    models?: Record<string, string[]>;
    /** Credential accounts with their quota, used by the parked-agent switcher. */
    accounts?: Array<{ provider: string; account: string; label: string; model: string; available: boolean; usedPercent: number | null; resetsAt: number | null; parkedAgents: number }>;
}): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const agent = opts.agent;
    const statusBadge = ctx.fns.ui.statusBadge ?? ((o: any) => `<span class="badge badge-sm">${esc(o.label)}</span>`);
    const progressBar = ctx.fns.ui.progressBar ?? ((o: any) => `<progress value="${Number(o.value)}" max="${Math.max(1, Number(o.max))}"></progress>`);
    const inspectorSection = ctx.fns.ui.inspectorSection ?? ((o: any) => `<details ${o.open ? 'open' : ''}><summary>${esc(o.title)}</summary><div>${o.html}</div></details>`);
    const id = encodeURIComponent(agent.id);

    if (opts.section === "goal") {
        const enabled = agent.scratchpad?.goalTrackingEnabled === true;
        const preview = agent.scratchpad?.goalSidecar ?? null;
        const goals = Array.isArray(preview?.goals) ? preview.goals : [];
        const toggle = `<form hx-post="/agent/${id}/goal-tracking" hx-swap="none" hx-trigger="change" class="mb-3">${ctx.fns.ui.toggle({ name: 'enabled', enabled, label: 'Track goals', hint: 'Run a display-only sidecar after new messages' })}</form>`;
        const tone = (status: string) => status === 'completed' ? 'success' : status === 'abandoned' ? 'neutral' : status === 'active' ? 'info' : 'warning';
        const sortedGoals = [...goals].sort((a: any, b: any) => Number(b?.sourceMessageIdx ?? 0) - Number(a?.sourceMessageIdx ?? 0));
        const currentGoals = sortedGoals.filter((item: any) => String(item?.status) !== 'completed');
        const completedGoals = sortedGoals.filter((item: any) => String(item?.status) === 'completed');
        const renderGoal = (item: any) => `<li class="rounded-lg border border-ui-border bg-base-100/35 px-2.5 py-2"><div class="flex items-start gap-2"><div class="min-w-0 flex-1 text-xs leading-5 text-base-content/75">${esc(item.statement)}</div>${statusBadge({ label: String(item.status ?? 'candidate'), tone: tone(String(item.status ?? 'candidate')) })}</div>${item.verification ? `<div class="mt-2 border-l-2 border-info/35 pl-2 text-[10px] leading-4 text-base-content/55"><span class="font-medium text-base-content/65">Check:</span> ${esc(item.verification)}</div>` : ''}<div class="mt-1 font-mono text-[9px] text-base-content/35">${esc(item.id)} · message ${Number(item.sourceMessageIdx ?? 0)}</div></li>`;
        const currentRows = currentGoals.length ? currentGoals.map(renderGoal).join('') : (!completedGoals.length ? '<li class="rounded-lg border border-dashed border-ui-border px-2.5 py-3 text-xs leading-5 text-base-content/40">No goals observed yet. Send a message after enabling tracking.</li>' : '');
        const completedRows = completedGoals.length ? `<details class="mt-2 rounded-lg border border-ui-border bg-base-100/20"><summary class="cursor-pointer px-2.5 py-2 text-[10px] font-medium text-base-content/55">Completed (${completedGoals.length})</summary><ol class="space-y-2 border-t border-ui-border p-2">${completedGoals.map(renderGoal).join('')}</ol></details>` : '';
        const state = !enabled
            ? '<p class="mt-2 text-[10px] text-base-content/35">Tracking is off for this agent.</p>'
            : preview?.status === 'error'
                ? `<p class="mt-2 text-[10px] leading-4 text-error">Sidecar failed: ${esc(preview.error ?? 'unknown error')}</p>`
                : preview?.status === 'ready'
                    ? `<p class="mt-2 text-[10px] text-base-content/35">Observed from message ${Number(preview.sourceMessageIdx ?? 0)}${preview.sidecarId ? ` · sidecar ${esc(preview.sidecarId)}` : ''}</p>`
                    : '<p class="mt-2 text-[10px] text-base-content/35">Display-only preview; it does not affect agent execution.</p>';
        const body = `${toggle}<ol class="space-y-2">${currentRows}</ol>${completedRows}${state}`;
        return inspectorSection({ title: 'Observed goals', icon: 'target', badge: statusBadge({ label: enabled ? String(goals.length) : 'off', tone: enabled && goals.length ? 'info' : 'neutral' }), html: body, collapsible: true, open: enabled });
    }


    if (opts.section === "knowledge") {
        // Rendered by the knowledge plugin when it is mounted; an empty slot otherwise.
        const render = (ctx.fns as any).knowledge?.agentMetaSection;
        return typeof render === "function" ? String(render({ agent }) ?? "") : "";
    }
    if (opts.section === "automation") {
        // Reflection and Sleep were removed with their worker passes; what is
        // left is the retrieval path, where the gate decides whether a turn
        // needs a runtime function at all and the reranker orders what survives.
        const body = `<form hx-post="/agent/${id}/automation" hx-swap="none" hx-trigger="change delay:200ms" class="space-y-1">${ctx.fns.ui.toggle({ label: 'Function RAG', name: 'functionRagEnabled', enabled: agent.functionRagEnabled === true, hint: 'Retrieve relevant runtime functions for each user prompt' })}${ctx.fns.ui.toggle({ label: 'Pre-retrieval Gate', name: 'functionRagGateEnabled', enabled: agent.functionRagGateEnabled === true, hint: 'Heuristically skip retrieval for conversational turns; errors allow retrieval', title: agent.functionRagEnabled === true ? '' : 'Requires Function RAG' })}${ctx.fns.ui.toggle({ label: 'Jev rerank', name: 'jevRerankEnabled', enabled: agent.jevRerankEnabled === true, hint: 'Score and filter retrieved candidates independently of Gate', title: agent.functionRagEnabled === true ? '' : 'Requires Function RAG' })}</form>`;
        return inspectorSection({ title: 'Automation', icon: 'sliders-horizontal', html: body, collapsible: true });
    }

    if (opts.section === "schedules") {
        const schedules = opts.schedules ?? [];
        const delay = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 86_400_000)}d`;
        const rows = schedules.map((task: any) => {
            const args = typeof task.args === "string" ? JSON.parse(task.args) : task.args ?? {};
            const status = task.state === "running" ? "Running" : task.enabled ? "Active" : "Paused";
            const next = task.enabled && task.nextRunAt ? `next ${new Date(Number(task.nextRunAt)).toLocaleString()}` : "not scheduled";
            const controls = `<div class="mt-2 flex flex-wrap gap-1"><form hx-post="/agent/${id}/schedules" hx-swap="none"><input type="hidden" name="name" value="${esc(task.name)}"><button class="btn btn-xs" name="action" value="run">Run now</button></form><form hx-post="/agent/${id}/schedules" hx-swap="none"><input type="hidden" name="name" value="${esc(task.name)}"><button class="btn btn-xs" name="action" value="${task.enabled ? "pause" : "resume"}">${task.enabled ? "Pause" : "Resume"}</button></form><form hx-post="/agent/${id}/schedules" hx-swap="none" hx-confirm="Delete this schedule?"><input type="hidden" name="name" value="${esc(task.name)}"><button class="btn btn-xs text-error" name="action" value="delete">Delete</button></form></div>`;
            return `<li class="rounded-lg border border-ui-border bg-base-100/35 px-2.5 py-2"><div class="flex items-center gap-2"><span class="badge badge-sm">${status}</span><span class="text-[10px] text-base-content/45">Every ${delay(Number(task.everyMs ?? 0))}</span></div><div class="mt-1 line-clamp-3 text-xs leading-5 text-base-content/75">${esc(args.text ?? "")}</div><div class="mt-1 text-[9px] text-base-content/35">${esc(next)}${task.lastStatus ? ` · last ${esc(task.lastStatus)}` : ""}</div>${controls}</li>`;
        }).join("");
        const form = `<form hx-post="/agent/${id}/schedules" hx-swap="none" class="mt-3 space-y-2"><input type="hidden" name="action" value="add"><textarea name="text" required maxlength="20000" rows="3" placeholder="Prompt to inject" class="w-full rounded border border-ui-border bg-base-100 p-2 text-xs"></textarea><div class="flex gap-2"><input name="every" required value="24h" placeholder="24h, 30m…" class="min-w-0 flex-1 rounded border border-ui-border bg-base-100 px-2 py-1 text-xs"><label class="flex items-center gap-1 text-[10px]"><input type="checkbox" name="now" value="1"> run now</label><button class="btn btn-xs btn-primary" type="submit">+ Schedule</button></div></form>`;
        return inspectorSection({ title: 'Schedules', icon: 'calendar-clock', badge: schedules.length || undefined, html: `${rows ? `<ul class="space-y-2">${rows}</ul>` : `<div class="text-[11px] text-base-content/40">No recurring prompts.</div>`}${form}`, collapsible: true });
    }


    if (opts.section === "wake") {
        const body = agent.wakeAt ? `<div class="truncate text-[11px] leading-5 text-base-content/55" title="${esc(agent.wakeReason ?? '')}">${esc(agent.wakeReason ?? '')}</div><form hx-post="/agent/${id}/wake" hx-swap="none" class="mt-2"><input type="hidden" name="action" value="cancel">${ctx.fns.procs.ui.button({ action: 'cancel-wake', label: 'Cancel', tone: 'danger', size: 'xs' })}</form>` : `<form hx-post="/agent/${id}/wake" hx-swap="none" class="space-y-2"><input type="hidden" name="action" value="set"><input name="reason" value="Continue scheduled work" maxlength="1000" aria-label="Wake reason" class="input input-bordered input-sm w-full text-xs"><div class="flex items-center gap-1"><input name="minutes" type="number" min="1" max="10080" value="5" aria-label="Wake in minutes" class="input input-bordered input-sm w-16 text-xs"><span class="text-[10px] text-base-content/40">min</span>${ctx.fns.procs.ui.button({ action: 'wake-preset', label: '5m', name: 'preset', value: '5', tone: 'ghost', size: 'xs' })}${ctx.fns.procs.ui.button({ action: 'wake-preset', label: '1h', name: 'preset', value: '60', tone: 'ghost', size: 'xs' })}${ctx.fns.procs.ui.button({ action: 'set-wake', label: 'Set', type: 'submit', tone: 'primary', size: 'xs', class: 'ml-auto' })}</div></form>`;
        // A parked agent gets its recovery actions ABOVE the generic wake controls:
        // the wait is already scheduled, what the user needs is a way out of it.
        const parkedHtml = ctx.fns.ui.parkedCard?.({ agent, models: opts.models, accounts: opts.accounts }) ?? '';
        return inspectorSection({ title: 'Wake-up', icon: 'alarm', badge: agent.wakeAt ? ctx.fns.ui.wakeTimer({ agent }) : statusBadge({ label: 'off' }), html: `${parkedHtml}${parkedHtml ? '<div class="mt-2"></div>' : ''}${body}`, collapsible: true, open: !!parkedHtml });
    }

    if (opts.section === "team") {
        const team = Array.isArray(opts.team) ? opts.team : [];
        const archivedTeam = Array.isArray(opts.archivedTeam) ? opts.archivedTeam : [];
        const allTeam = [...team, ...archivedTeam];
        if (!allTeam.length) return '';
        return inspectorSection({
            title: 'Team', icon: 'users-three', badge: statusBadge({ label: String(team.length), tone: team.some((member: any) => member.status === 'failed' || member.status === 'blocked') ? 'error' : team.some((member: any) => member.status === 'working') ? 'info' : 'neutral' }), collapsible: true,
            open: team.some((member: any) => member.status === 'working' || member.status === 'blocked' || member.status === 'failed'), html: `
      ${archivedTeam.length ? `<label class="mt-2 flex items-center gap-1.5 text-[10px] text-base-content/55"><input type="checkbox" onchange="this.closest('details').querySelector('[data-team-archive-list]').classList.toggle('hidden', !this.checked)"> Show archived (${archivedTeam.length})</label>` : ''}
      <div class="space-y-2">${team.map((member: any) => {
                const memberTasks = Array.isArray(member.plan?.tasks) ? member.plan.tasks : [];
                const memberDone = memberTasks.filter((task: any) => task.status === 'done').length;
                const statusTone = member.status === 'ready' ? 'success' : member.status === 'failed' || member.status === 'blocked' ? 'error' : member.status === 'working' ? 'info' : 'neutral';
                const memberBadge = statusBadge({ label: String(member.status), tone: statusTone, dot: member.status === 'working' });
                return `<details class="group overflow-hidden rounded-lg border border-ui-border bg-base-200" ${member.status === 'working' ? 'open' : ''}>
          <summary class="flex min-h-10 cursor-pointer list-none items-center gap-2 px-2.5 py-2 hover:bg-base-200/60"><i class="ph ph-robot text-base-content/75"></i><span class="min-w-0 flex-1 truncate text-xs font-medium text-base-content">${esc(member.title || `Agent ${member.id}`)}</span>${memberBadge}<span class="font-mono text-[10px] tabular-nums text-base-content/45">${memberDone}/${memberTasks.length}</span><i class="ph ph-caret-down text-[10px] text-base-content/35 transition-transform group-open:rotate-180"></i></summary>
          <div class="space-y-2 border-t border-ui-border px-2.5 py-2">
            ${memberTasks.length ? progressBar({ value: memberDone, max: memberTasks.length, label: member.plan?.title || 'Task progress', showValue: false }) : ''}
            <div class="space-y-1.5">${memberTasks.map((task: any) => `<div class="text-[11px] leading-4 ${task.status === 'done' ? 'text-base-content/40' : task.status === 'active' ? 'text-base-content/80' : 'text-base-content/60'}"><div class="flex items-start gap-1.5"><i class="ph ${task.status === 'done' ? 'ph-check-circle text-success' : task.status === 'active' ? 'ph-circle-notch animate-spin' : 'ph-circle'} mt-0.5"></i><span>${esc(task.title)}</span></div>${task.resultSummary ? `<div class="ml-4 mt-0.5 text-base-content/50">${esc(task.resultSummary)}</div>` : ''}</div>`).join('')}</div>
            ${member.summary ? `<div class="mt-2 border-t border-ui-border pt-2 text-[10px] leading-4 text-base-content/55">${esc(member.summary)}</div>` : ''}
            <div class="flex items-center gap-1 border-t border-ui-border pt-2">${ctx.fns.procs.ui.button({ action: 'open-team-member', href: `/agent/${encodeURIComponent(member.id)}`, html: '<i class="ph ph-arrow-square-out"></i> Open', tone: 'ghost', size: 'xs' })}${member.status === 'working' || member.runState === 'running' ? `<form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/stop" hx-swap="none" hx-confirm="Stop this subagent?">${ctx.fns.procs.ui.button({ action: 'stop-team-member', html: '<i class="ph ph-stop-circle"></i> Stop', appearance: 'plain', size: 'xs', class: 'rounded px-1.5 text-base-content/45 transition hover:bg-base-100/45 hover:text-base-content/75' })}</form>` : ''}${member.status === 'blocked' || member.status === 'failed' ? `<form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/retry" hx-swap="none">${ctx.fns.procs.ui.button({ action: 'retry-team-member', html: '<i class="ph ph-arrow-clockwise"></i> Retry', tone: 'ghost', size: 'xs' })}</form>` : ''}${member.status !== 'working' && member.runState !== 'running' ? `<form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/archive" hx-swap="none">${ctx.fns.procs.ui.button({ action: 'archive-team-member', html: '<i class="ph ph-archive"></i> Archive', tone: 'ghost', size: 'xs' })}</form>` : ''}</div>
          </div>
        </details>`;
            }).join('')}</div>
      ${archivedTeam.length ? `<div data-team-archive-list class="mt-2 hidden space-y-2">${archivedTeam.map((member: any) => { const archivedTasks = Array.isArray(member.plan?.tasks) ? member.plan.tasks : []; return `<details class="rounded-lg border border-ui-border bg-base-200 opacity-80"><summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2"><i class="ph ph-archive text-base-content/45"></i><span class="min-w-0 flex-1 truncate text-xs text-base-content/65">${esc(member.title || `Agent ${member.id}`)}</span><span class="text-[10px] text-base-content/45">${archivedTasks.filter((task: any) => task.status === 'done').length}/${archivedTasks.length}</span></summary><div class="border-t border-ui-border px-2.5 py-2"><div class="space-y-1">${archivedTasks.map((task: any) => `<div class="text-[10px] leading-4 text-base-content/55"><div class="flex items-start gap-1.5"><i class="ph ${task.status === 'done' ? 'ph-check-circle' : 'ph-circle'} mt-0.5"></i><span>${esc(task.title)}</span></div>${task.resultSummary ? `<div class="ml-4 mt-0.5 text-base-content/45">${esc(task.resultSummary)}</div>` : ''}</div>`).join('')}</div>${member.summary ? `<div class="mt-2 border-t border-ui-border pt-2 text-[10px] leading-4 text-base-content/55">${esc(member.summary)}</div>` : ''}<div class="mt-2 flex items-center gap-2"><form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/unarchive" hx-swap="none" hx-on::after-request="if(event.detail.successful) location.href='/agent/${encodeURIComponent(member.id)}'">${ctx.fns.procs.ui.button({ action: 'restore-team-member', html: '<i class="ph ph-arrow-counter-clockwise"></i> Restore &amp; open', appearance: 'plain', class: 'text-[10px] text-indigo-600 hover:text-indigo-800' })}</form></div></div></details>`; }).join('')}</div>` : ''}
      ` });
    }

    if (opts.section === "plan") {
        const plan = agent.scratchpad?.plan ?? null;
        const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
        if (!tasks.length) return '';
        const doneCount = tasks.filter((task: any) => task.status === 'done').length;
        const body = `<form data-plan-editor hx-post="/agent/${id}/plan" hx-swap="none" class="space-y-3"><input type="hidden" name="action" value="update"><div class="flex items-center gap-2"><input name="title" maxlength="300" value="${esc(plan.title || '')}" aria-label="Plan title" class="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-xs font-medium text-base-content outline-none focus:ring-0">${ctx.fns.procs.ui.button({ action: 'archive-plan', html: '<i class="ph ph-archive"></i>', type: 'submit', tone: 'ghost', size: 'xs', title: 'Archive plan', attrs: { form: `plan-archive-${id}` } })}${ctx.fns.procs.ui.button({ action: 'delete-plan', html: '<i class="ph ph-trash"></i>', type: 'submit', tone: 'ghost', size: 'xs', title: 'Delete plan', attrs: { form: `plan-delete-${id}` } })}</div>${plan.pausedAt ? `<div class="rounded-md bg-warning/10 px-2 py-1 text-[11px] text-warning">Paused by user</div>` : ''}<div id="plan-tasks-${esc(agent.id)}" data-plan-tasks class="space-y-2">${tasks.map((task: any) => ctx.fns.ui.planTaskRow({ task })).join('')}</div><div class="flex items-center gap-2">${ctx.fns.procs.ui.button({ action: 'add-plan-task', html: '<i class="ph ph-plus"></i>', get: `/ui/agent/${id}/plan/task`, target: `#plan-tasks-${esc(agent.id)}`, swap: 'beforeend', tone: 'ghost', size: 'xs', title: 'Add task', ariaLabel: 'Add task' })}<div class="h-px flex-1 bg-base-300"></div>${ctx.fns.procs.ui.button({ action: 'save-plan', label: 'Save', type: 'submit', tone: 'primary', size: 'xs' })}</div></form><form id="plan-archive-${id}" hx-post="/agent/${id}/plan" hx-swap="none" hx-confirm="Archive this plan?"><input type="hidden" name="action" value="archive"></form><form id="plan-delete-${id}" hx-post="/agent/${id}/plan" hx-swap="none" hx-confirm="Delete this plan permanently?"><input type="hidden" name="action" value="delete"></form>`;
        return inspectorSection({ title: String(plan.title || 'Plan'), icon: 'list-checks', badge: statusBadge({ label: `${doneCount}/${tasks.length}`, tone: doneCount === tasks.length ? 'success' : 'info' }), html: body, collapsible: true, open: tasks.some((task: any) => task.status === 'active') });
    }

    throw new Error(`agentMetaSection: unknown section "${String(opts.section)}" — expected goal, automation, wake, team or plan`);
}
