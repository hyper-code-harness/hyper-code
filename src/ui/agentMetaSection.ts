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
    section: "goal" | "knowledge" | "automation" | "settings" | "team" | "plan";
    /** Active durable wake, cron and condition triggers for this agent. */
    triggers?: any[];
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
        const renderGoal = (item: any) => `<li class="rounded-lg border border-ui-border bg-base-100/35 px-2.5 py-2"><div class="flex items-start gap-2"><div class="min-w-0 flex-1 text-xs leading-5 text-muted">${esc(item.statement)}</div>${statusBadge({ label: String(item.status ?? 'candidate'), tone: tone(String(item.status ?? 'candidate')) })}</div>${item.verification ? `<div class="mt-2 border-l-2 border-info/35 pl-2 text-3xs leading-4 text-subtle"><span class="font-medium text-muted">Check:</span> ${esc(item.verification)}</div>` : ''}<div class="mt-1 font-mono text-micro text-faint">${esc(item.id)} · message ${Number(item.sourceMessageIdx ?? 0)}</div></li>`;
        const currentRows = currentGoals.length ? currentGoals.map(renderGoal).join('') : (!completedGoals.length ? '<li class="rounded-lg border border-dashed border-ui-border px-2.5 py-3 text-xs leading-5 text-faint">No goals observed yet. Send a message after enabling tracking.</li>' : '');
        const completedRows = completedGoals.length ? `<details class="mt-2 rounded-lg border border-ui-border bg-base-100/20"><summary class="cursor-pointer px-2.5 py-2 text-3xs font-medium text-subtle">Completed (${completedGoals.length})</summary><ol class="space-y-2 border-t border-ui-border p-2">${completedGoals.map(renderGoal).join('')}</ol></details>` : '';
        const state = !enabled
            ? '<p class="mt-2 text-3xs text-faint">Tracking is off for this agent.</p>'
            : preview?.status === 'error'
                ? `<p class="mt-2 text-3xs leading-4 text-error">Sidecar failed: ${esc(preview.error ?? 'unknown error')}</p>`
                : preview?.status === 'ready'
                    ? `<p class="mt-2 text-3xs text-faint">Observed from message ${Number(preview.sourceMessageIdx ?? 0)}${preview.sidecarId ? ` · sidecar ${esc(preview.sidecarId)}` : ''}</p>`
                    : '<p class="mt-2 text-3xs text-faint">Display-only preview; it does not affect agent execution.</p>';
        const body = `${toggle}<ol class="space-y-2">${currentRows}</ol>${completedRows}${state}`;
        return inspectorSection({ title: 'Observed goals', icon: 'target', badge: statusBadge({ label: enabled ? String(goals.length) : 'off', tone: enabled && goals.length ? 'info' : 'neutral' }), html: body, collapsible: true, open: enabled });
    }


    if (opts.section === "knowledge") {
        // Rendered by the knowledge plugin when it is mounted; an empty slot otherwise.
        const render = (ctx.fns as any).knowledge?.agentMetaSection;
        return typeof render === "function" ? String(render({ agent }) ?? "") : "";
    }
    if (opts.section === "automation") {
        const triggers = opts.triggers ?? [];
        const activeTriggers = triggers.filter((trigger: any) => trigger.status === "active" || trigger.status === "checking");
        const recentTriggers = triggers.filter((trigger: any) => trigger.status !== "active" && trigger.status !== "checking").slice(0, 10);
        const kindLabel: Record<string, string> = { at: "Wake-up", cron: "Schedule", watch: "Watch" };
        const renderTrigger = (trigger: any, active: boolean) => {
            const config = typeof trigger.config === "string" ? JSON.parse(trigger.config) : trigger.config ?? {};
            const detail = trigger.kind === "cron" ? `${config.expression ?? ""} · ${trigger.timezone ?? "UTC"}` : trigger.kind === "watch" ? `${config.predicate ?? "condition"} · ${trigger.mode}` : "one time";
            const when = trigger.nextAt ? `next ${new Date(Number(trigger.nextAt)).toLocaleString()}` : trigger.lastRunAt ? `last ${new Date(Number(trigger.lastRunAt)).toLocaleString()}` : trigger.status;
            const runState = trigger.lastOutcome ? `${trigger.lastOutcome}${trigger.attempts ? ` · ${trigger.attempts} attempt${Number(trigger.attempts) === 1 ? "" : "s"}` : ""}` : trigger.status;
            const runError = trigger.lastRunError ?? trigger.lastError;
            let result = "";
            if (trigger.lastResult != null) { try { result = JSON.stringify(trigger.lastResult); } catch { result = String(trigger.lastResult); } }
            const inspection = runError ? `<div class="mt-1 break-words rounded bg-error/10 px-2 py-1 text-3xs text-error">${esc(runError)}</div>` : result && result !== "null" ? `<div class="mt-1 line-clamp-3 break-words rounded bg-base-200/60 px-2 py-1 font-mono text-micro text-subtle">${esc(result)}</div>` : "";
            const runNowButton = ctx.fns.procs.ui.button({ label: "Run now", name: "action", value: "run", type: "submit", tone: "ghost", size: "xs", action: "run-trigger" });
            const cancelButton = ctx.fns.procs.ui.button({ label: "Cancel", name: "action", value: "cancel", type: "submit", tone: "danger", size: "xs", action: "cancel-trigger" });
            const auditButton = ctx.fns.procs.ui.button({ label: trigger.attempts ? `Audit · ${trigger.attempts}` : "Audit", get: `/agent/${id}/trigger/${encodeURIComponent(String(trigger.id))}`, target: "#app-popup-body", swap: "innerHTML", tone: "ghost", size: "xs", action: "trigger-audit" });
            const controls = `<div class="mt-2 flex gap-1">${auditButton}${active ? `<form hx-post="/agent/${id}/triggers" hx-swap="none"><input type="hidden" name="triggerId" value="${esc(trigger.id)}">${runNowButton}</form><form hx-post="/agent/${id}/triggers" hx-swap="none"><input type="hidden" name="triggerId" value="${esc(trigger.id)}">${cancelButton}</form>` : ""}</div>`;
            return `<li class="rounded-lg border border-ui-border bg-base-100/35 px-2.5 py-2"><div class="flex items-center gap-2"><span class="badge badge-sm">${esc(kindLabel[trigger.kind] ?? trigger.kind)}</span><span class="truncate text-3xs text-faint">${esc(detail)}</span><span class="ml-auto text-micro text-faint">${esc(trigger.status)}</span></div><div class="mt-1 line-clamp-3 text-xs leading-5 text-muted">${esc(trigger.prompt)}</div><div class="mt-1 text-micro text-faint">${esc(when)} · ${esc(runState)}</div>${inspection}${controls}</li>`;
        };
        const rows = activeTriggers.map((trigger: any) => renderTrigger(trigger, true)).join("");
        const history = recentTriggers.map((trigger: any) => renderTrigger(trigger, false)).join("");
        const wakeForm = `<form hx-post="/agent/${id}/triggers" hx-swap="none" class="space-y-2"><input type="hidden" name="action" value="wake"><input name="prompt" value="Continue scheduled work" required class="input input-bordered input-sm w-full text-xs"><div class="flex items-center gap-2"><input name="minutes" type="number" min="1" max="10080" value="5" class="input input-bordered input-sm w-20 text-xs"><span class="text-3xs text-faint">minutes</span>${ctx.fns.procs.ui.button({ label: '+ Wake-up', type: 'submit', tone: 'primary', size: 'xs', class: 'ml-auto', action: 'add-wake' })}</div></form>`;
        const cronForm = `<form hx-post="/agent/${id}/triggers" hx-swap="none" class="space-y-2"><input type="hidden" name="action" value="cron"><input name="prompt" placeholder="Prompt" required class="input input-bordered input-sm w-full text-xs"><div class="grid grid-cols-2 gap-2"><input name="expression" value="0 9 * * *" required class="input input-bordered input-sm text-xs"><input name="timezone" value="UTC" required class="input input-bordered input-sm text-xs"></div>${ctx.fns.procs.ui.button({ label: '+ Schedule', type: 'submit', tone: 'primary', size: 'xs', action: 'add-cron' })}</form>`;
        const watchForm = `<form hx-post="/agent/${id}/triggers" hx-swap="none" class="space-y-2"><input type="hidden" name="action" value="watch"><input name="prompt" placeholder="Prompt when ready" required class="input input-bordered input-sm w-full text-xs"><div class="grid grid-cols-2 gap-2"><select name="predicate" class="select select-bordered select-sm text-xs"><option value="file.exists">File exists</option><option value="http.ok">HTTP OK</option><option value="db.rows">DB rows</option><option value="runtime.fn">Runtime function</option></select><input name="value" placeholder="path / URL / SQL / function" required class="input input-bordered input-sm text-xs"></div><div class="flex gap-2"><input name="everySeconds" type="number" min="5" value="60" title="Check every seconds" class="input input-bordered input-sm w-20 text-xs"><input name="timeoutMinutes" type="number" min="0" value="0" title="Timeout minutes; 0 means none" class="input input-bordered input-sm w-20 text-xs"><select name="mode" class="select select-bordered select-sm text-xs"><option value="once">Once</option><option value="edge">Every edge</option></select>${ctx.fns.procs.ui.button({ label: '+ Watch', type: 'submit', tone: 'primary', size: 'xs', class: 'ml-auto', action: 'add-watch' })}</div></form>`;
        const addPopupId = `agent-trigger-add-${String(agent.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const addButton = ctx.fns.procs.ui.button({ label: "Add trigger", html: '<i class="ph ph-plus" aria-hidden="true"></i><span>Add trigger</span><i class="ph ph-caret-down text-3xs" aria-hidden="true"></i>', tone: "primary", size: "xs", action: "add-trigger", class: "mt-3 w-full justify-center gap-1.5", attrs: { popovertarget: addPopupId, "aria-haspopup": "dialog", style: `anchor-name:--${addPopupId}` } });
        const add = `${addButton}<div id="${esc(addPopupId)}" popover style="position-anchor:--${esc(addPopupId)}" class="inplace-popup-panel w-72 max-w-[calc(100vw-2rem)]"><div class="mb-2 text-3xs font-semibold uppercase tracking-wide text-faint">New trigger</div><div class="space-y-2"><details class="rounded-lg border border-ui-border"><summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium"><i class="ph ph-alarm"></i><span>Wake-up</span><span class="ml-auto text-3xs text-faint">once</span></summary><div class="border-t border-ui-border p-3">${wakeForm}</div></details><details class="rounded-lg border border-ui-border"><summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium"><i class="ph ph-calendar-clock"></i><span>Schedule</span><span class="ml-auto text-3xs text-faint">cron</span></summary><div class="border-t border-ui-border p-3">${cronForm}</div></details><details class="rounded-lg border border-ui-border"><summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium"><i class="ph ph-eye"></i><span>Watch condition</span><span class="ml-auto text-3xs text-faint">event</span></summary><div class="border-t border-ui-border p-3">${watchForm}</div></details></div></div>`;
        const cancelAll = activeTriggers.length ? `<form hx-post="/agent/${id}/triggers" hx-swap="none" hx-confirm="Cancel all triggers?" class="mt-3">${ctx.fns.procs.ui.button({ label: 'Cancel all', name: 'action', value: 'cancelAll', tone: 'danger', size: 'xs', action: 'cancel-all-triggers' })}</form>` : "";
        const parkedHtml = ctx.fns.ui.parkedCard?.({ agent, models: opts.models, accounts: opts.accounts }) ?? "";
        return inspectorSection({ title: "Automation", icon: "lightning", badge: activeTriggers.length ? String(activeTriggers.length) : statusBadge({ label: "off" }), html: `${parkedHtml}${parkedHtml ? '<div class="mt-2"></div>' : ''}${rows ? `<ul class="space-y-2">${rows}</ul>` : '<div class="text-2xs text-faint">No active triggers.</div>'}${cancelAll}${add}${history ? `<details class="mt-3"><summary class="cursor-pointer text-2xs font-medium">Recent runs</summary><ul class="mt-2 space-y-2">${history}</ul></details>` : ""}`, collapsible: true, open: !!parkedHtml });
    }

    if (opts.section === "settings") {
        const body = `<form hx-post="/agent/${id}/automation" hx-swap="none" hx-trigger="change delay:200ms" class="space-y-1">${ctx.fns.ui.toggle({ label: 'Function RAG', name: 'functionRagEnabled', enabled: agent.functionRagEnabled === true, hint: 'Retrieve relevant runtime functions for each user prompt' })}${ctx.fns.ui.toggle({ label: 'Pre-retrieval Gate', name: 'functionRagGateEnabled', enabled: agent.functionRagGateEnabled === true, hint: 'Heuristically skip retrieval for conversational turns; errors allow retrieval', title: agent.functionRagEnabled === true ? '' : 'Requires Function RAG' })}${ctx.fns.ui.toggle({ label: 'Jev rerank', name: 'jevRerankEnabled', enabled: agent.jevRerankEnabled === true, hint: 'Score and filter retrieved candidates independently of Gate', title: agent.functionRagEnabled === true ? '' : 'Requires Function RAG' })}</form>`;
        return inspectorSection({ title: 'Agent settings', icon: 'sliders-horizontal', html: body, collapsible: true });
    }


    if (opts.section === "team") {
        const team = Array.isArray(opts.team) ? opts.team : [];
        const archivedTeam = Array.isArray(opts.archivedTeam) ? opts.archivedTeam : [];
        const allTeam = [...team, ...archivedTeam];
        if (!allTeam.length) return '';
        return inspectorSection({
            title: 'Team', icon: 'users-three', badge: statusBadge({ label: String(team.length), tone: team.some((member: any) => member.status === 'failed' || member.status === 'blocked') ? 'error' : team.some((member: any) => member.status === 'working') ? 'info' : 'neutral' }), collapsible: true,
            open: team.some((member: any) => member.status === 'working' || member.status === 'blocked' || member.status === 'failed'), html: `
      ${archivedTeam.length ? `<label class="mt-2 flex items-center gap-1.5 text-3xs text-subtle"><input type="checkbox" onchange="this.closest('details').querySelector('[data-team-archive-list]').classList.toggle('hidden', !this.checked)"> Show archived (${archivedTeam.length})</label>` : ''}
      <div class="space-y-2">${team.map((member: any) => {
                const memberTasks = Array.isArray(member.plan?.tasks) ? member.plan.tasks : [];
                const memberDone = memberTasks.filter((task: any) => task.status === 'done').length;
                const statusTone = member.status === 'ready' ? 'success' : member.status === 'failed' || member.status === 'blocked' ? 'error' : member.status === 'working' ? 'info' : 'neutral';
                const memberBadge = statusBadge({ label: String(member.status), tone: statusTone, dot: member.status === 'working' });
                return `<details class="group overflow-hidden rounded-lg border border-ui-border bg-base-200" ${member.status === 'working' ? 'open' : ''}>
          <summary class="flex min-h-10 cursor-pointer list-none items-center gap-2 px-2.5 py-2 hover:bg-base-200/60"><i class="ph ph-robot text-muted"></i><span class="min-w-0 flex-1 truncate text-xs font-medium text-base-content">${esc(member.title || `Agent ${member.id}`)}</span>${memberBadge}<span class="font-mono text-3xs tabular-nums text-faint">${memberDone}/${memberTasks.length}</span><i class="ph ph-caret-down text-3xs text-faint transition-transform group-open:rotate-180"></i></summary>
          <div class="space-y-2 border-t border-ui-border px-2.5 py-2">
            ${memberTasks.length ? progressBar({ value: memberDone, max: memberTasks.length, label: member.plan?.title || 'Task progress', showValue: false }) : ''}
            <div class="space-y-1.5">${memberTasks.map((task: any) => `<div class="text-2xs leading-4 ${task.status === 'done' ? 'text-faint' : task.status === 'active' ? 'text-muted' : 'text-subtle'}"><div class="flex items-start gap-1.5"><i class="ph ${task.status === 'done' ? 'ph-check-circle text-success' : task.status === 'active' ? 'ph-circle-notch animate-spin' : 'ph-circle'} mt-0.5"></i><span>${esc(task.title)}</span></div>${task.resultSummary ? `<div class="ml-4 mt-0.5 text-subtle">${esc(task.resultSummary)}</div>` : ''}</div>`).join('')}</div>
            ${member.summary ? `<div class="mt-2 border-t border-ui-border pt-2 text-3xs leading-4 text-subtle">${esc(member.summary)}</div>` : ''}
            <div class="flex items-center gap-1 border-t border-ui-border pt-2">${ctx.fns.procs.ui.button({ action: 'open-team-member', href: `/agent/${encodeURIComponent(member.id)}`, html: '<i class="ph ph-arrow-square-out"></i> Open', tone: 'ghost', size: 'xs' })}${member.status === 'working' || member.runState === 'running' ? `<form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/stop" hx-swap="none" hx-confirm="Stop this subagent?">${ctx.fns.procs.ui.button({ action: 'stop-team-member', html: '<i class="ph ph-stop-circle"></i> Stop', appearance: 'plain', size: 'xs', class: 'rounded px-1.5 text-faint transition hover:bg-base-100/45 hover:text-muted' })}</form>` : ''}${member.status === 'blocked' || member.status === 'failed' ? `<form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/retry" hx-swap="none">${ctx.fns.procs.ui.button({ action: 'retry-team-member', html: '<i class="ph ph-arrow-clockwise"></i> Retry', tone: 'ghost', size: 'xs' })}</form>` : ''}${member.status !== 'working' && member.runState !== 'running' ? `<form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/archive" hx-swap="none">${ctx.fns.procs.ui.button({ action: 'archive-team-member', html: '<i class="ph ph-archive"></i> Archive', tone: 'ghost', size: 'xs' })}</form>` : ''}</div>
          </div>
        </details>`;
            }).join('')}</div>
      ${archivedTeam.length ? `<div data-team-archive-list class="mt-2 hidden space-y-2">${archivedTeam.map((member: any) => { const archivedTasks = Array.isArray(member.plan?.tasks) ? member.plan.tasks : []; return `<details class="rounded-lg border border-ui-border bg-base-200 opacity-80"><summary class="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2"><i class="ph ph-archive text-faint"></i><span class="min-w-0 flex-1 truncate text-xs text-muted">${esc(member.title || `Agent ${member.id}`)}</span><span class="text-3xs text-faint">${archivedTasks.filter((task: any) => task.status === 'done').length}/${archivedTasks.length}</span></summary><div class="border-t border-ui-border px-2.5 py-2"><div class="space-y-1">${archivedTasks.map((task: any) => `<div class="text-3xs leading-4 text-subtle"><div class="flex items-start gap-1.5"><i class="ph ${task.status === 'done' ? 'ph-check-circle' : 'ph-circle'} mt-0.5"></i><span>${esc(task.title)}</span></div>${task.resultSummary ? `<div class="ml-4 mt-0.5 text-faint">${esc(task.resultSummary)}</div>` : ''}</div>`).join('')}</div>${member.summary ? `<div class="mt-2 border-t border-ui-border pt-2 text-3xs leading-4 text-subtle">${esc(member.summary)}</div>` : ''}<div class="mt-2 flex items-center gap-2"><form hx-post="/agent/${id}/team/${encodeURIComponent(member.id)}/unarchive" hx-swap="none" hx-on::after:request="if(event.detail.ctx?.response?.status < 400) location.href='/agent/${encodeURIComponent(member.id)}'">${ctx.fns.procs.ui.button({ action: 'restore-team-member', html: '<i class="ph ph-arrow-counter-clockwise"></i> Restore &amp; open', appearance: 'plain', class: 'text-3xs text-primary hover:text-primary' })}</form></div></div></details>`; }).join('')}</div>` : ''}
      ` });
    }

    if (opts.section === "plan") {
        const plan = agent.scratchpad?.plan ?? null;
        const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
        if (!tasks.length) return '';
        const doneCount = tasks.filter((task: any) => task.status === 'done').length;
        const body = `<form data-plan-editor hx-post="/agent/${id}/plan" hx-swap="none" class="space-y-3"><input type="hidden" name="action" value="update"><div class="flex items-center gap-2"><input name="title" maxlength="300" value="${esc(plan.title || '')}" aria-label="Plan title" class="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-xs font-medium text-base-content outline-none focus:ring-0">${ctx.fns.procs.ui.button({ action: 'archive-plan', html: '<i class="ph ph-archive"></i>', type: 'submit', tone: 'ghost', size: 'xs', title: 'Archive plan', attrs: { form: `plan-archive-${id}` } })}${ctx.fns.procs.ui.button({ action: 'delete-plan', html: '<i class="ph ph-trash"></i>', type: 'submit', tone: 'ghost', size: 'xs', title: 'Delete plan', attrs: { form: `plan-delete-${id}` } })}</div>${plan.pausedAt ? `<div class="rounded-md bg-warning/10 px-2 py-1 text-2xs text-warning">Paused by user</div>` : ''}<div id="plan-tasks-${esc(agent.id)}" data-plan-tasks class="space-y-2">${tasks.map((task: any) => ctx.fns.ui.planTaskRow({ task })).join('')}</div><div class="flex items-center gap-2">${ctx.fns.procs.ui.button({ action: 'add-plan-task', html: '<i class="ph ph-plus"></i>', get: `/ui/agent/${id}/plan/task`, target: `#plan-tasks-${esc(agent.id)}`, swap: 'beforeend', tone: 'ghost', size: 'xs', title: 'Add task', ariaLabel: 'Add task' })}<div class="h-px flex-1 bg-base-300"></div>${ctx.fns.procs.ui.button({ action: 'save-plan', label: 'Save', type: 'submit', tone: 'primary', size: 'xs' })}</div></form><form id="plan-archive-${id}" hx-post="/agent/${id}/plan" hx-swap="none" hx-confirm="Archive this plan?"><input type="hidden" name="action" value="archive"></form><form id="plan-delete-${id}" hx-post="/agent/${id}/plan" hx-swap="none" hx-confirm="Delete this plan permanently?"><input type="hidden" name="action" value="delete"></form>`;
        return inspectorSection({ title: String(plan.title || 'Plan'), icon: 'list-checks', badge: statusBadge({ label: `${doneCount}/${tasks.length}`, tone: doneCount === tasks.length ? 'success' : 'info' }), html: body, collapsible: true, open: tasks.some((task: any) => task.status === 'active') });
    }

    throw new Error(`agentMetaSection: unknown section "${String(opts.section)}" — expected goal, automation, wake, team or plan`);
}
