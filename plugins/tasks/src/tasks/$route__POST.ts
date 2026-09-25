/**
 * Creates a task from submitted form data and redirects to its detail page.
 *
 * @param ctx - Runtime context used to create the task.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request containing task form data.
 * @param opts.params - Route parameters (unused by this collection route).
 * @returns A validation response or redirect to the created task.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    const description = String(form.get('description') ?? '').trim();
    const workspaceMode = form.get('workspaceMode') === 'isolated' ? 'isolated' : 'default';
    if (!description) return Response.json({ error: 'description is required' }, { status: 400 });
    const task = await ctx.fns.tasks.create({ description, workspaceMode });
    if (opts.req.headers.get('hx-request') === 'true') return ctx.fns.procs.ui.respond({ location: `/tasks/${encodeURIComponent(task.id)}`, toast: { message: 'Task created' } });
    return new Response(null, { status: 303, headers: { location: `/tasks/${encodeURIComponent(task.id)}` } });
}
