/** Queue context compaction from the native chat menu without interrupting the current turn. */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming JSON request with optional focus instructions. */ req: Request;
    /** Route parameters containing the agent id. */ params: Record<string, string>;
}): Promise<Response> {
    const id = opts.params.id!;
    const agent = ctx.state.agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return Response.json({ error: "not_found", message: "Agent not found" }, { status: 404 });
    // Empty or malformed JSON uses the default summary, as does an omitted focus.
    const body: unknown = await opts.req.json().catch(() => null);
    const focus = body && typeof body === "object" && "instructions" in body ? body.instructions : undefined;
    const instructions = typeof focus === "string" ? focus.trim() || undefined : undefined;
    try {
        const result = await ctx.fns.agent.requestCompaction({ agentId: id, instructions });
        return Response.json({ version: 1, ok: true, status: result.status, jobId: result.jobId }, { status: 202 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ error: "compact_failed", message }, { status: /running|already running/i.test(message) ? 409 : 400 });
    }
}
