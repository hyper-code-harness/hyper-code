/** Publishes a session from the Shared Agents form. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    const agentId = String(form.get("agentId") ?? "").trim();
    try {
        await ctx.fns.sharedAgent.publish({
            agentId,
            name: String(form.get("name") ?? ""),
            description: String(form.get("description") ?? ""),
            capabilities: String(form.get("capabilities") ?? "").split(","),
        });
    } catch (error: any) {
        return new Response(String(error?.message ?? error), { status: 400 });
    }
    return new Response(null, { status: 303, headers: { location: `/shared-agents?from=${encodeURIComponent(agentId)}&agent=${encodeURIComponent(agentId)}` } });
}
