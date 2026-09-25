/**
 * Updates a task status from submitted form data and redirects to the task.
 *
 * @param ctx - Runtime context used to update the task.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request containing the new status.
 * @param opts.params - Route parameters containing the task identifier.
 * @returns A validation response or redirect to the updated task.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    const status = String(form.get('status') ?? '');
    if (!['todo', 'running', 'done'].includes(status)) return Response.json({ error: 'invalid status' }, { status: 400 });
    const task = await ctx.fns.tasks.setStatus({ id: opts.params.id!, status: status as any });
    if (opts.req.headers.get('hx-request') === 'true') return ctx.fns.procs.ui.respond({ location: `/tasks/${encodeURIComponent(task.id)}`, toast: { message: 'Status updated' } });
    return new Response(null, { status: 303, headers: { location: `/tasks/${encodeURIComponent(task.id)}` } });
}
