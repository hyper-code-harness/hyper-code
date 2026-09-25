/** Handles the id automation post HTTP route.  * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Incoming HTTP request. */
req: Request;
        /** Values bound to the operation. */
params: Record<string, string> }) {
    const form = await opts.req.formData();
    // The form carries every automation toggle and is posted on any change, so an
    // absent field means the user just unchecked it — not "leave it alone".
    // Sending undefined here made every toggle one-way: switchable on, never off.
    try {
        await ctx.fns.agent.setAutomation({
            id: opts.params.id!,
            functionRagEnabled: form.get('functionRagEnabled') === '1',
            jevRerankEnabled: form.get('jevRerankEnabled') === '1',
            functionRagGateEnabled: form.get('functionRagGateEnabled') === '1',
        });
    } catch (error: any) {
        return new Response(error?.message ?? 'Invalid automation settings', { status: 400 });
    }
    return new Response(null, { status: 204 });
}
