/**
 * Starts a task and redirects to its detail page.
 *
 * @param ctx - Runtime context used to start the task.
 * @param _session - Unused request session.
 * @param opts - HTTP route options.
 * @param opts.req - Incoming request (currently unused).
 * @param opts.params - Route parameters containing the task identifier.
 * @returns A redirect to the started task.
 */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const task = await ctx.fns.tasks.start({ id: opts.params.id! });
    if (opts.req.headers.get('hx-request') === 'true') return ctx.fns.procs.ui.respond({ location: `/tasks/${encodeURIComponent(task.id)}`, toast: { message: 'Agent started' } });
    return new Response(null, { status: 303, headers: { location: `/tasks/${encodeURIComponent(task.id)}` } });
}
