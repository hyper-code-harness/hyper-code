/** Performs the ui.planTaskRow runtime operation. */
/**
 * Render an editable plan task row with status and elapsed time.
 * @param opts.task Plan task data to render.
 * @param opts.autofocus Whether to focus the task editor.
 */
export default function (ctx: Context, _session: Session | null, opts: {
        /** Plan task to render. */ task: any;
        /** Whether the task input should receive focus. */ autofocus?: boolean }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const task = opts.task ?? {};
    const status = String(task.status ?? 'pending');
    const active = status === 'active';
    const icon = status === 'done' ? 'ph-check-circle text-success' : active ? 'ph-circle-notch text-primary' : 'ph-circle text-faint';
    const elapsed = Math.max(0, Number(task.elapsedMs ?? 0)) + (active && task.activeSince ? Math.max(0, Date.now() - Number(task.activeSince)) : 0);
    const seconds = Math.floor(elapsed / 1000);
    const time = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `<div data-plan-task data-task-id="${esc(task.id)}" data-task-status="${esc(status)}" class="rounded-lg ${active ? 'border border-ui-border bg-base-100/35 p-2' : 'px-2 py-1'}">
      <input type="hidden" name="task_id" value="${esc(task.id)}">
      <div class="flex items-start gap-2 text-xs"><i class="ph ${icon} mt-2"></i><div class="min-w-0 flex-1">
        <input name="task_title" maxlength="300" value="${esc(task.title ?? '')}" required ${opts.autofocus ? 'autofocus' : ''} placeholder="Task title" aria-label="Task title" class="w-full border-0 bg-transparent p-0 ${status === 'done' ? 'text-faint line-through' : active ? 'font-medium text-base-content' : 'text-muted'} outline-none focus:ring-0">
        <textarea name="task_instructions" maxlength="12000" rows="${active ? 3 : opts.autofocus ? 2 : 1}" placeholder="Detailed instructions" aria-label="Task instructions" class="mt-1 w-full resize-y border-0 bg-transparent p-0 text-2xs leading-4 ${active ? 'text-muted' : 'text-faint'} outline-none focus:ring-0">${esc(task.instructions ?? '')}</textarea>
        <code class="block truncate text-micro text-faint">${esc(task.id)}</code>
      </div><div class="flex shrink-0 items-center gap-0.5"><span class="text-3xs text-faint">${time}</span>${status === 'pending' ? `${ctx.fns.procs.ui.button({ action: 'move-plan-task-up', html: '<i class="ph ph-arrow-up"></i>', appearance: 'plain', title: 'Move up', ariaLabel: 'Move up', class: 'rounded p-1 text-faint hover:bg-base-200', attrs: { 'data-plan-move': 'up' } })}${ctx.fns.procs.ui.button({ action: 'move-plan-task-down', html: '<i class="ph ph-arrow-down"></i>', appearance: 'plain', title: 'Move down', ariaLabel: 'Move down', class: 'rounded p-1 text-faint hover:bg-base-200', attrs: { 'data-plan-move': 'down' } })}${ctx.fns.procs.ui.button({ action: 'remove-plan-task', html: '<i class="ph ph-x"></i>', appearance: 'plain', title: 'Remove task', ariaLabel: 'Remove task', class: 'rounded p-1 text-faint hover:bg-red-50 hover:text-red-600', attrs: { 'data-plan-remove': true } })}` : ''}</div></div>
    </div>`;
}
