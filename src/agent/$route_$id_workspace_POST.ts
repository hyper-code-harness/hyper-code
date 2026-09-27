/** Handles the id workspace post HTTP route.  * @param opts.req Incoming HTTP request.
 * @param opts.params Route path parameters.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming HTTP request. */
    req: Request;
        /** Values bound to the operation. */
    params: Record<string, string> },
) {
    const id = opts.params.id!;
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response("Not Found", { status: 404 });

    const form = await opts.req.formData();
    try {
        const agentCtx: any = Object.create(ctx);
        agentCtx.session = ctx.fns.session.forAgent({ agent });
        const raw = String(form.get("workspaceDir") ?? "").trim();
        // "host:path" selects a remote workspace; the host must be a known ssh alias
        // so a local path containing ":" is never mistaken for one.
        const m = /^([A-Za-z0-9._@-]+):(.*)$/.exec(raw);
        const hosts = m ? (await ctx.fns.remote.servers({})).map((s: any) => s.name) : [];
        const remote = m && hosts.includes(m[1]!) ? { host: m[1]!, dir: m[2] || "~" } : null;
        const explicitHost = String(form.get("workspaceHost") ?? "").trim();
        await agentCtx.fns.workspace.set(remote ?? { dir: raw, host: explicitHost || undefined });
    } catch (error: any) {
        return new Response(error?.message ?? "Invalid workspace", { status: 400 });
    }

    return new Response(null, {
        status: 303,
        headers: { location: `/agent/${encodeURIComponent(id)}` },
    });
}