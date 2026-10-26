/** Handles the id status-line post HTTP route.  * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request;
        /** Values bound to the operation. */
params: Record<string, string> }) {
    const form = await opts.req.formData();
    const text = String(form.get('text') ?? '');
    const every = Number(form.get('every') ?? 1);
    const mode = String(form.get('mode') ?? 'custom') as 'global' | 'custom' | 'off';
    try {
        await ctx.fns.agent.setStatusLine({
            id: opts.params.id!,
            text,
            every,
            mode,
        });
    } catch (error: any) {
        return new Response(error?.message ?? 'Invalid status line', { status: 400 });
    }
    // A fresh opener replaces the old one; the page script closes the panel on success.
    const { trigger } = await ctx.fns.chat.promptInject({ agentId: opts.params.id! });
    return ctx.fns.w.respond({ html: trigger });
}
