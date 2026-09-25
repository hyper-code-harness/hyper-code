/** Delegates a task from the Shared Agents form. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    const agentId = String(form.get("agentId") ?? "").trim();
    const requesterId = String(form.get("requesterId") ?? "").trim();
    try {
        await ctx.fns.sharedAgent.delegate({
            agentId,
            task: String(form.get("task") ?? ""),
            requesterId: requesterId || undefined,
        });
    } catch (error: any) {
        return new Response(String(error?.message ?? error), { status: 400 });
    }
    const query = new URLSearchParams({ agent: agentId });
    if (requesterId) query.set("from", requesterId);
    return new Response(null, { status: 303, headers: { location: `/shared-agents?${query}` } });
}
