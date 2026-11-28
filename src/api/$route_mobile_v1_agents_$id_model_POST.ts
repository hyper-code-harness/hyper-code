/** Changes the model for one native mobile chat. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    let body: any;
    try { body = await opts.req.json(); } catch { return Response.json({ error: "invalid_json", message: "Expected JSON" }, { status: 400 }); }
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) return Response.json({ error: "model_required", message: "Model is required" }, { status: 400 });
    try {
        const claudeAccount = typeof body.claudeAccount === "string" ? body.claudeAccount.trim() || undefined : undefined;
        const result = await ctx.fns.agent.setModel({ id: opts.params.id!, model, scope: "agent", claudeAccount });
        return Response.json({ version: 1, ok: true, model: result.model, from: result.from });
    } catch (error: any) {
        return Response.json({ error: "model_change_failed", message: String(error?.message ?? error) }, { status: 400 });
    }
}
