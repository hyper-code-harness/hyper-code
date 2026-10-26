/**
 * Renders a task detail page.
 *
 * @param ctx - Runtime context used to load the task and render shared UI components.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request (currently unused).
 * @param opts.params - Route parameters containing the task identifier.
 * @returns The task page or a 404 response.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const task = await ctx.fns.tasks.get({ id: opts.params.id! });
    if (!task) return new Response('Not found', { status: 404 });
    const w = ctx.fns.w;
    const esc = (value: unknown) => w.escape({ text: value });
    const muted = w.mix({ mixes: [{ ink: 'muted', text: 'small' }] });
    const id = encodeURIComponent(task.id);
    const lines = task.description.split(/\r?\n/);
    const titleIndex = lines.findIndex((line) => line.trim());
    const title = titleIndex >= 0 ? lines[titleIndex]!.trim() : 'Untitled task';
    const body = lines.slice(titleIndex + 1).join('\n').trim();
    const statusBadge = task.status === 'done' ? w.badge({ text: 'Closed', tone: 'info' })
        : task.status === 'running' ? w.badge({ text: 'In progress', tone: 'warning' })
        : w.badge({ text: 'Open', tone: 'success' });
    const statusOptions = ([['todo', 'Open', 'dot-outline'], ['running', 'In progress', 'spinner'], ['done', 'Closed', 'check-circle']] as const)
        .map(([status, label, icon]) => w.button({
            label, icon, wide: true, tone: task.status === status ? 'primary' : 'ghost',
            marks: { action: 'set-status', id: status, status: task.status === status ? 'active' : '' },
            action: { post: `/tasks/${id}/status`, vals: { status } },
        })).join('');
    const agentPanel = task.agentId
        ? w.toolbar({ start: `<div><strong>Agent chat ${esc(task.agentId)}</strong><div class="${muted}">Workspace: <code>${esc(task.workspaceDir)}</code></div></div>`, end: w.button({ label: 'Open chat', icon: 'arrow-square-out', marks: { action: 'open-agent-chat' }, action: { href: `/agent/${encodeURIComponent(task.agentId)}` } }) })
        : w.toolbar({ start: `<div><strong>No agent started</strong><div class="${muted}">Start a dedicated chat in the selected workspace.</div></div>`, end: w.button({ label: 'Start agent', icon: 'play', tone: 'success', marks: { action: 'start-agent' }, action: { post: `/tasks/${id}/start` } }) });
    const workspace = task.workspaceDir || (task.workspaceMode === 'isolated' ? '~/.hyper/tasks/<task-id>' : '~/.hyper/tasks');
    return {
        title,
        main: w.page({
            page: 'task',
            crumbs: w.crumbs({ items: [{ label: 'Tasks', href: '/tasks' }, { label: `#${task.id.slice(0, 8)}` }] }),
            title,
            lead: `${statusBadge} <span class="${muted}">created ${esc(new Date(Number(task.createdAt)).toLocaleString())}</span>`,
            body: w.card({ title: 'Description', body: body ? `<pre class="${w.mix({ mixes: [{ text: 'read' }] })}" style="white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;margin:0">${esc(body)}</pre>` : `<span class="${muted}">No additional description.</span>` })
                + w.card({ title: 'Agent', body: agentPanel }),
            aside: w.card({ title: 'Status', body: statusOptions })
                + w.card({ title: 'Workspace', body: w.keyValue({ items: [{ key: 'Mode', value: task.workspaceMode === 'isolated' ? 'Isolated' : 'Shared' }, { key: 'Path', html: `<code>${esc(workspace)}</code>` }] }) })
                + w.card({ title: 'Development', body: task.agentId ? `<a href="/agent/${encodeURIComponent(task.agentId)}">Attached chat</a>` : `<span class="${muted}">No chat yet</span>` }),
        }),
    };
}
