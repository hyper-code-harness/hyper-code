/** Removes a session from the Shared Agents registry. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    const agentId = String(form.get("agentId") ?? "").trim();
    try {
        await ctx.fns.sharedAgent.unpublish({ agentId });
    } catch (error: any) {
        return new Response(String(error?.message ?? error), { status: 400 });
    }
    return new Response(null, { status: 303, headers: { location: "/shared-agents" } });
}
