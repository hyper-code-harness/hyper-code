/**
 * Renders the task-list page.
 *
 * @param ctx - Runtime context used to query tasks and escape HTML.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request whose query selects open or closed tasks.
 * @param opts.params - Route parameters (unused by this collection route).
 * @returns The rendered task-list HTML response.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const tasks = await ctx.fns.tasks.list({});
    const esc = (value: unknown) => ctx.fns.procs.ui.escape({ text: String(value ?? '') });
    const url = new URL(opts.req.url);
    const view = url.searchParams.get('view') === 'closed' ? 'closed' : 'open';
    const open = tasks.filter((task) => task.status !== 'done');
    const closed = tasks.filter((task) => task.status === 'done');
    const visible = view === 'closed' ? closed : open;
    const issue = (task: types.tasks.Task) => {
        const lines = task.description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const title = lines[0] || 'Untitled task';
        const preview = lines.slice(1).join(' ').slice(0, 180);
        const running = task.status === 'running';
        const done = task.status === 'done';
        const icon = done ? 'ph-check-circle' : 'ph-dot-outline';
        const iconColor = done ? 'text-violet-600' : running ? 'text-amber-600' : 'text-emerald-600';
        const badge = running
            ? '<span class="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">agent running</span>'
            : task.agentId
                ? '<span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">chat attached</span>'
                : '';
        return `<div class="group flex gap-3 border-t border-ui-border px-4 py-3 hover:bg-base-200">
          <i class="ph ${icon} mt-0.5 text-xl ${iconColor}"></i>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <a href="/tasks/${encodeURIComponent(task.id)}" class="font-semibold text-base-content hover:text-blue-600">${esc(title)}</a>${badge}
            </div>
            ${preview ? `<p class="mt-1 truncate text-sm text-subtle">${esc(preview)}</p>` : ''}
            <p class="mt-1 text-xs text-subtle">#${esc(task.id.slice(0, 8))} · ${esc(task.workspaceMode === 'isolated' ? 'isolated workspace' : '~/.hyper/tasks')} · updated ${esc(relativeTime(Number(task.updatedAt)))}</p>
          </div>
          ${task.agentId ? `<a href="/agent/${encodeURIComponent(task.agentId)}" title="Open attached chat" class="mt-1 text-faint hover:text-blue-600"><i class="ph ph-chat-circle text-lg"></i></a>` : ''}
        </div>`;
    };
    return {
        title: 'Tasks',
        main: `<main class="mx-auto w-full max-w-5xl px-5 py-7">
          <div class="mb-5 flex items-center justify-between gap-4">
            <div><h1 class="text-2xl font-semibold tracking-tight text-base-content">Tasks</h1><p class="mt-1 text-sm text-subtle">One focused agent chat for every task.</p></div>
            ${ctx.fns.procs.ui.button({ action: 'new-task', html: '<i class="ph ph-plus mr-1"></i>New task', tone: 'success', attrs: { onclick: "document.getElementById('new-task').showModal()" } })}
          </div>

          <div class="overflow-hidden rounded-md border border-ui-border bg-base-100 shadow-sm">
            <div class="flex items-center justify-between border-b border-ui-border bg-base-200 px-4 py-3">
              <nav class="flex items-center gap-5 text-sm">
                <a href="/tasks?view=open" class="flex items-center gap-1.5 ${view === 'open' ? 'font-semibold text-base-content' : 'text-subtle hover:text-base-content'}"><i class="ph ph-dot-outline text-lg"></i>${open.length} Open</a>
                <a href="/tasks?view=closed" class="flex items-center gap-1.5 ${view === 'closed' ? 'font-semibold text-base-content' : 'text-subtle hover:text-base-content'}"><i class="ph ph-check text-base"></i>${closed.length} Closed</a>
              </nav>
              <span class="text-xs text-subtle">${visible.length} task${visible.length === 1 ? '' : 's'}</span>
            </div>
            ${visible.length ? visible.map(issue).join('') : `<div class="px-6 py-16 text-center"><i class="ph ph-check-circle text-4xl text-faint"></i><h2 class="mt-3 font-semibold text-base-content">No ${view} tasks</h2><p class="mt-1 text-sm text-subtle">${view === 'open' ? 'Create a task to start an agent.' : 'Completed tasks will appear here.'}</p></div>`}
          </div>

          <dialog id="new-task" class="m-auto w-[min(94vw,640px)] rounded-lg border border-ui-border p-0 shadow-2xl backdrop:bg-black/40">
            <form method="POST" action="/tasks">
              <div class="flex items-center justify-between border-b border-ui-border px-5 py-4"><h2 class="font-semibold text-base-content">Create a new task</h2>${ctx.fns.procs.ui.button({ action: 'close-new-task', html: '<i class="ph ph-x text-lg"></i>', tone: 'ghost', ariaLabel: 'Close', attrs: { onclick: "document.getElementById('new-task').close()" } })}</div>
              <div class="space-y-4 p-5">
                <label class="block"><span class="mb-2 block text-sm font-semibold text-base-content">Description</span><textarea name="description" required autofocus rows="7" placeholder="What should the agent do?" class="w-full rounded-md border border-ui-border px-3 py-2 text-sm shadow-inner outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"></textarea></label>
                <label class="block"><span class="mb-2 block text-sm font-semibold text-base-content">Workspace</span><select name="workspaceMode" class="w-full rounded-md border border-ui-border bg-base-100 px-3 py-2 text-sm"><option value="default">Shared · ~/.hyper/tasks</option><option value="isolated">Isolated · ~/.hyper/tasks/&lt;task-id&gt;</option></select><span class="mt-1.5 block text-xs text-subtle">The directory is created when the attached agent starts.</span></label>
              </div>
              <div class="flex justify-end gap-2 border-t border-ui-border bg-base-200 px-5 py-3">${ctx.fns.procs.ui.button({ action: 'cancel-new-task', label: 'Cancel', attrs: { onclick: "document.getElementById('new-task').close()" } })}${ctx.fns.procs.ui.button({ action: 'create-task', label: 'Create task', type: 'submit', tone: 'success' })}</div>
            </form>
          </dialog>
        </main>`,
    };
}

/**
 * Formats a timestamp as a compact age relative to now.
 *
 * @param ts - Unix timestamp in milliseconds.
 * @returns Human-readable relative time.
 */
function relativeTime(ts: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
