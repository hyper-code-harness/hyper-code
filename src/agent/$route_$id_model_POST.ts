/** Handles the agent :id model POST HTTP route — switching a live agent's model.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */
    req: Request;
    /** Route path parameters. */
    params: Record<string, string>;
}) {
    const form = await opts.req.formData();
    const model = String(form.get("model") ?? "").trim();
    // The checkbox on the parked card: move every agent stuck on the same
    // exhausted credential, not just the one being looked at.
    const scope = String(form.get("scope") ?? "agent") === "provider" ? "provider" : "agent";
    try {
        const claudeAccount = String(form.get("claudeAccount") ?? "").trim() || undefined;
        const result = await ctx.fns.agent.setModel({ id: opts.params.id!, model, scope, claudeAccount });
        return new Response(null, { status: 204, headers: { "HX-Refresh": "true", "x-hyper-changed": String(result.changed.length) } });
    } catch (error: any) {
        return new Response(error?.message ?? "Invalid model", { status: 400 });
    }
}
