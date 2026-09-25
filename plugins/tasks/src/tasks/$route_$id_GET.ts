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
    const ui = ctx.fns.procs.ui;
    const esc = (value: unknown) => ui.escape({ text: value });
    const id = encodeURIComponent(task.id);
    const lines = task.description.split(/\r?\n/);
    const titleIndex = lines.findIndex((line) => line.trim());
    const title = titleIndex >= 0 ? lines[titleIndex]!.trim() : 'Untitled task';
    const body = lines.slice(titleIndex + 1).join('\n').trim();
    const statusBadge = task.status === 'done' ? ui.badge({ text: 'Closed', tone: 'info' })
        : task.status === 'running' ? ui.badge({ text: 'In progress', tone: 'warning' })
        : ui.badge({ text: 'Open', tone: 'success' });
    const statusOptions = ([['todo', 'Open', 'ph-dot-outline'], ['running', 'In progress', 'ph-spinner'], ['done', 'Closed', 'ph-check-circle']] as const)
        .map(([status, label, icon]) => ui.button({
            action: 'set-status', id: status, post: `/tasks/${id}/status`, vals: { status }, tone: task.status === status ? 'primary' : 'ghost', active: task.status === status,
            class: 'w-full justify-start', html: `<i class="ph ${icon}" aria-hidden="true"></i>${label}`,
        })).join('');
    const agentPanel = task.agentId
        ? ui.toolbar({ left: `<div><p class="font-semibold">Agent chat ${esc(task.agentId)}</p><p class="mt-1 text-sm text-subtle">Workspace: <code class="rounded bg-base-200 px-1 py-0.5 text-xs">${esc(task.workspaceDir)}</code></p></div>`, right: ui.button({ action: 'open-agent-chat', href: `/agent/${encodeURIComponent(task.agentId)}`, html: '<i class="ph ph-arrow-square-out" aria-hidden="true"></i>Open chat' }) })
        : ui.toolbar({ left: '<div><p class="font-semibold">No agent started</p><p class="mt-1 text-sm text-subtle">Start a dedicated chat in the selected workspace.</p></div>', right: ui.button({ action: 'start-agent', post: `/tasks/${id}/start`, tone: 'success', html: '<i class="ph ph-play" aria-hidden="true"></i>Start agent' }) });
    return {
        title,
        main: ui.detailPage({
            page: 'task',
            back: { href: '/tasks', label: 'Back to tasks' },
            title, id: task.id.slice(0, 8),
            status: statusBadge,
            meta: [`created ${new Date(Number(task.createdAt)).toLocaleString()}`],
            main: `${ui.card({ title: 'Description', body: body ? `<pre class="whitespace-pre-wrap break-words font-sans text-sm">${esc(body)}</pre>` : '<p class="text-sm text-faint">No additional description.</p>' })}
              <div class="mt-5">${ui.card({ title: 'Agent', body: agentPanel })}</div>`,
            aside: [
                { title: 'Status', body: `<div class="space-y-1">${statusOptions}</div>` },
                { title: 'Workspace', body: `<p class="text-muted"><i class="ph ph-folder mr-1" aria-hidden="true"></i>${esc(task.workspaceMode === 'isolated' ? 'Isolated' : 'Shared')}</p><p class="mt-1 break-all text-xs text-subtle">${esc(task.workspaceDir || (task.workspaceMode === 'isolated' ? '~/.hyper/tasks/<task-id>' : '~/.hyper/tasks'))}</p>` },
                { title: 'Development', body: `<p class="text-muted"><i class="ph ph-chat-circle mr-1" aria-hidden="true"></i>${task.agentId ? `<a href="/agent/${encodeURIComponent(task.agentId)}" class="text-primary hover:underline">Attached chat</a>` : 'No chat yet'}</p>` },
            ],
        }),
    };
}
