/**
 * Renders a task detail page.
 *
 * @param ctx - Runtime context used to load the task and escape HTML.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request (currently unused).
 * @param opts.params - Route parameters containing the task identifier.
 * @returns The task HTML response or a 404 response.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const task = await ctx.fns.tasks.get({ id: opts.params.id! });
    if (!task) return new Response('Not found', { status: 404 });
    const esc = (value: unknown) => ctx.fns.procs.ui.escape({ text: String(value ?? '') });
    const lines = task.description.split(/\r?\n/);
    const titleIndex = lines.findIndex((line) => line.trim());
    const title = titleIndex >= 0 ? lines[titleIndex]!.trim() : 'Untitled task';
    const body = lines.slice(titleIndex + 1).join('\n').trim();
    const isDone = task.status === 'done';
    const stateBadge = isDone
        ? '<span class="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-sm font-medium text-white"><i class="ph ph-check"></i>Closed</span>'
        : `<span class="inline-flex items-center gap-1.5 rounded-full ${task.status === 'running' ? 'bg-amber-600' : 'bg-green-600'} px-3 py-1 text-sm font-medium text-white"><i class="ph ph-dot-outline"></i>${task.status === 'running' ? 'In progress' : 'Open'}</span>`;
    const statusAction = (status: 'todo' | 'running' | 'done', label: string, icon: string) => ctx.fns.procs.ui.button({ action: 'set-status', name: 'status', value: status, appearance: 'plain', active: task.status === status, html: `<i class="ph ${icon}"></i>${label}${task.status === status ? '<i class="ph ph-check ml-auto"></i>' : ''}`, class: `flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm ${task.status === status ? 'bg-blue-50 font-semibold text-blue-700' : 'text-muted hover:bg-base-200'}` });
    return {
        title,
        main: `<main class="mx-auto w-full max-w-5xl px-5 py-7">
          <a href="/tasks" class="mb-5 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><i class="ph ph-arrow-left"></i>Back to tasks</a>
          <header class="border-b border-ui-border pb-5">
            <h1 class="break-words text-3xl font-normal leading-tight text-base-content">${esc(title)} <span class="font-light text-faint">#${esc(task.id.slice(0, 8))}</span></h1>
            <div class="mt-3 flex items-center gap-2">${stateBadge}<span class="text-sm text-subtle">created ${esc(new Date(Number(task.createdAt)).toLocaleString())}</span></div>
          </header>

          <div class="mt-6 grid gap-7 md:grid-cols-[minmax(0,1fr)_260px]">
            <section class="min-w-0">
              <div class="flex gap-3">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-base-content font-semibold text-base-100"><i class="ph ph-robot"></i></div>
                <div class="min-w-0 flex-1 overflow-hidden rounded-md border border-ui-border bg-base-100">
                  <div class="border-b border-ui-border bg-base-200 px-4 py-2.5 text-sm text-muted"><strong class="text-base-content">Task</strong> described this work</div>
                  <div class="min-h-32 whitespace-pre-wrap break-words px-4 py-4 text-sm leading-6 text-base-content">${esc(body || title)}</div>
                </div>
              </div>

              <div class="ml-5 mt-4 h-8 border-l-2 border-ui-border"></div>
              <div class="flex gap-3">
                <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${task.agentId ? 'bg-blue-600' : 'bg-base-300'} text-white"><i class="ph ph-chat-circle"></i></div>
                <div class="flex-1 rounded-md border border-ui-border bg-base-100 p-4">
                  ${task.agentId
                    ? `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-semibold text-base-content">Agent chat ${esc(task.agentId)}</p><p class="mt-1 text-sm text-subtle">Workspace: <code class="rounded bg-base-200 px-1 py-0.5 text-xs">${esc(task.workspaceDir)}</code></p></div>${ctx.fns.procs.ui.button({ action: 'open-agent-chat', href: `/agent/${encodeURIComponent(task.agentId)}`, html: '<i class="ph ph-arrow-square-out mr-1"></i>Open chat' })}</div>`
                    : `<div class="flex flex-wrap items-center justify-between gap-3"><div><p class="font-semibold text-base-content">No agent started</p><p class="mt-1 text-sm text-subtle">Start a dedicated chat in the selected workspace.</p></div><form method="POST" action="/tasks/${encodeURIComponent(task.id)}/start">${ctx.fns.procs.ui.button({ action: 'start-agent', html: '<i class="ph ph-play mr-1"></i>Start agent', tone: 'success' })}</form></div>`}
                </div>
              </div>
            </section>

            <aside class="space-y-5 text-sm">
              <section><h2 class="mb-2 border-b border-ui-border pb-2 font-semibold text-muted">Status</h2><form method="POST" action="/tasks/${encodeURIComponent(task.id)}/status" class="space-y-1">${statusAction('todo', 'Open', 'ph-dot-outline')}${statusAction('running', 'In progress', 'ph-spinner')}${statusAction('done', 'Closed', 'ph-check-circle')}</form></section>
              <section><h2 class="mb-2 border-b border-ui-border pb-2 font-semibold text-muted">Workspace</h2><p class="text-muted"><i class="ph ph-folder mr-1"></i>${esc(task.workspaceMode === 'isolated' ? 'Isolated' : 'Shared')}</p><p class="mt-1 break-all text-xs text-subtle">${esc(task.workspaceDir || (task.workspaceMode === 'isolated' ? '~/.hyper/tasks/<task-id>' : '~/.hyper/tasks'))}</p></section>
              <section><h2 class="mb-2 border-b border-ui-border pb-2 font-semibold text-muted">Development</h2><p class="text-muted"><i class="ph ph-chat-circle mr-1"></i>${task.agentId ? `<a href="/agent/${encodeURIComponent(task.agentId)}" class="text-blue-600 hover:underline">Attached chat</a>` : 'No chat yet'}</p></section>
            </aside>
          </div>
        </main>`,
    };
}
