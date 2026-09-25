/**
 * Renders the task-list page.
 *
 * @param ctx - Runtime context used to query tasks and render shared UI components.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request whose query selects open or closed tasks and a search text.
 * @param opts.params - Route parameters (unused by this collection route).
 * @returns The rendered task-list page.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const ui = ctx.fns.procs.ui;
    const url = new URL(opts.req.url);
    const view = url.searchParams.get('view') === 'closed' ? 'closed' : 'open';
    const q = (url.searchParams.get('q') ?? '').trim();
    const tasks = await ctx.fns.tasks.list({});
    const matches = (task: types.tasks.Task) => !q || task.description.toLowerCase().includes(q.toLowerCase());
    const open = tasks.filter((task) => task.status !== 'done' && matches(task));
    const closed = tasks.filter((task) => task.status === 'done' && matches(task));
    const visible = view === 'closed' ? closed : open;

    const row = (task: types.tasks.Task) => {
        const lines = task.description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const running = task.status === 'running';
        const done = task.status === 'done';
        const badge = running ? ui.badge({ text: 'agent running', tone: 'warning' })
            : task.agentId ? ui.badge({ text: 'chat attached', tone: 'info' }) : '';
        return ui.listItem({
            entity: 'task', id: task.id, status: task.status,
            href: `/tasks/${encodeURIComponent(task.id)}`,
            icon: done ? 'ph-check-circle' : 'ph-dot-outline',
            tone: done ? 'info' : running ? 'warning' : 'success',
            title: lines[0] || 'Untitled task',
            badges: badge,
            text: lines.slice(1).join(' ').slice(0, 180),
            meta: [`#${task.id.slice(0, 8)}`, task.workspaceMode === 'isolated' ? 'isolated workspace' : '~/.hyper/tasks', `updated ${relativeTime(Number(task.updatedAt))}`],
            right: task.agentId ? ui.button({ action: 'open-chat', id: task.id, href: `/agent/${encodeURIComponent(task.agentId)}`, html: '<i class="ph ph-chat-circle text-lg" aria-hidden="true"></i>', tone: 'ghost', size: 'xs', title: 'Open attached chat', ariaLabel: 'Open attached chat' }) : '',
        });
    };

    const newTask = ui.dialog({
        id: 'new-task', title: 'Create a new task', post: '/tasks', submitLabel: 'Create task', size: 'lg',
        body: `<label class="block"><span class="mb-1.5 block text-sm font-semibold">Description</span>${ui.textarea({ name: 'description', rows: 7, required: true, placeholder: 'What should the agent do?', ariaLabel: 'Description' })}</label>
          <label class="block"><span class="mb-1.5 block text-sm font-semibold">Workspace</span>${ui.select({ name: 'workspaceMode', value: 'default', placeholder: 'Workspace', options: [{ value: 'default', label: 'Shared · ~/.hyper/tasks' }, { value: 'isolated', label: 'Isolated · ~/.hyper/tasks/<task-id>' }] })}<span class="mt-1.5 block text-xs text-subtle">The directory is created when the attached agent starts.</span></label>`,
    });

    return {
        title: 'Tasks',
        main: ui.listPage({
            page: 'tasks',
            title: 'Tasks',
            lead: 'One focused agent chat for every task.',
            actions: ui.dialogButton({ dialog: 'new-task', label: 'New task', icon: 'ph-plus', tone: 'success', action: 'new-task' }),
            tabs: ui.tabs({ current: view, items: [
                { value: 'open', label: 'Open', icon: 'ph-dot-outline', count: open.length, href: `/tasks?view=open${q ? `&q=${encodeURIComponent(q)}` : ''}` },
                { value: 'closed', label: 'Closed', icon: 'ph-check', count: closed.length, href: `/tasks?view=closed${q ? `&q=${encodeURIComponent(q)}` : ''}` },
            ] }),
            filters: ui.filterBar({ href: '/tasks', q, placeholder: 'Search tasks', hidden: { view } }),
            rows: visible.map(row).join(''),
            empty: q
                ? { title: 'No matching tasks', text: `Nothing matches “${q}”.`, icon: 'ph-magnifying-glass' }
                : { title: view === 'closed' ? 'No closed tasks' : 'No open tasks', text: 'Create a task to start an agent.', icon: 'ph-check-square' },
            extra: newTask,
        }),
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
