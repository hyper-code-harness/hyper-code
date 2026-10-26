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
    const w = ctx.fns.w;
    const url = new URL(opts.req.url);
    const view = url.searchParams.get('view') === 'closed' ? 'closed' : 'open';
    const q = (url.searchParams.get('q') ?? '').trim();
    const tasks = await ctx.fns.tasks.list({});
    const matches = (task: types.tasks.Task) => !q || task.description.toLowerCase().includes(q.toLowerCase());
    const open = tasks.filter((task) => task.status !== 'done' && matches(task));
    const closed = tasks.filter((task) => task.status === 'done' && matches(task));
    const visible = view === 'closed' ? closed : open;
    const esc = (v: unknown) => w.escape({ text: v });
    const qs = (v: string) => `/tasks?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

    const row = (task: types.tasks.Task) => {
        const lines = task.description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const running = task.status === 'running';
        const done = task.status === 'done';
        const href = `/tasks/${encodeURIComponent(task.id)}`;
        const rest = lines.slice(1).join(' ').slice(0, 180);
        return w.record({
            entity: 'task', id: task.id, status: task.status,
            cells: [
                { role: 'state', html: w.icon({ name: done ? 'check-circle' : 'dot-outline', size: 16 }), tone: done ? 'info' : running ? 'warning' : 'success' },
                { role: 'title', grow: true, title: lines[0] || 'Untitled task', html: `<a href="${esc(href)}">${esc(lines[0] || 'Untitled task')}</a>${rest ? ` <span class="${w.mix({ mixes: [{ ink: "muted" }] })}">${esc(rest)}</span>` : ''}` },
                { role: 'badge', html: running ? w.badge({ text: 'agent running', tone: 'warning' }) : task.agentId ? w.badge({ text: 'chat attached', tone: 'info' }) : '' },
                { role: 'workspace', wide: true, text: `#${task.id.slice(0, 8)} · ${task.workspaceMode === 'isolated' ? 'isolated workspace' : '~/.hyper/tasks'}` },
                { role: 'updated', width: 'label', text: relativeTime(Number(task.updatedAt)) },
            ],
            end: task.agentId ? w.iconButton({ icon: 'chat-circle', label: 'Open attached chat', action: { href: `/agent/${encodeURIComponent(task.agentId)}` } }) : '',
        });
    };

    const newTask = w.dialog({
        id: 'new-task', title: 'Create a new task', post: '/tasks', submitLabel: 'Create task', size: 'lg',
        body: w.field({ name: 'description', label: 'Description', for: 'new-task-description', required: true, control: w.textarea({ name: 'description', id: 'new-task-description', rows: 7, required: true, placeholder: 'What should the agent do?' }) })
            + w.field({ name: 'workspaceMode', label: 'Workspace', for: 'new-task-workspace', help: 'The directory is created when the attached agent starts.', control: w.select({ name: 'workspaceMode', id: 'new-task-workspace', value: 'default', options: [{ value: 'default', label: 'Shared · ~/.hyper/tasks' }, { value: 'isolated', label: 'Isolated · ~/.hyper/tasks/<task-id>' }] }) }),
    });

    const tabs = w.tabs({ variant: 'underline', active: view, items: [
        { id: 'open', label: 'Open', icon: 'dot-outline', count: open.length, action: { href: qs('open') } },
        { id: 'closed', label: 'Closed', icon: 'check', count: closed.length, action: { href: qs('closed') } },
    ] });
    const search = w.form({ form: 'task-search', get: '/tasks', push: true, trigger: 'input changed delay:250ms from:find input, submit',
        body: `<input type="hidden" name="view" value="${esc(view)}">${w.input({ name: 'q', type: 'search', value: q, placeholder: 'Search tasks', label: 'Search tasks', width: 'auto' })}` });
    const empty = q
        ? w.empty({ title: 'No matching tasks', hint: `Nothing matches “${q}”.`, icon: 'magnifying-glass' })
        : w.empty({ title: view === 'closed' ? 'No closed tasks' : 'No open tasks', hint: 'Create a task to start an agent.', icon: 'check-square' });

    return {
        title: 'Tasks',
        main: w.page({
            page: 'tasks',
            title: 'Tasks',
            lead: 'One focused agent chat for every task.',
            actions: w.dialogOpener({ dialog: 'new-task', label: 'New task', icon: 'plus', tone: 'success', action: 'new-task' }),
            body: w.toolbar({ start: tabs, end: search }) + (visible.length ? w.card({ flush: true, body: visible.map(row).join('') }) : empty) + newTask,
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
