/** Queue context compaction after the agent's current turn without interrupting it. */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request containing optional focus instructions. */ req: Request;
    /** Route parameters containing the root agent id. */ params: Record<string, string>;
}): Promise<Response> {
    const id = opts.params.id!;
    const agent = ctx.state.agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response("not found", { status: 404 });
    try {
        const form = await opts.req.formData();
        const focus = form.get("instructions");
        const instructions = typeof focus === "string" ? focus.trim() || undefined : undefined;
        const result = await ctx.fns.agent.requestCompaction({ agentId: id, instructions });
        await ctx.fns.ui.notify({ message: "Compaction queued; it will run after the current turn.", level: "info" }).catch(() => undefined);
        return new Response(null, { status: 202, headers: { "HX-Refresh": "true", "X-Compaction-Status": result.status, "X-Compaction-Job": result.jobId } });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return new Response(message, { status: /running|already running/i.test(message) ? 409 : 400 });
    }
}
