/** Marks one agent read through the newest event visible to the native client. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const id = opts.params.id!;
    const row = ((await ctx.fns.procs.db.select({
        sql: "SELECT MAX(ts) AS ts FROM events WHERE agent_id = ?",
        params: [id],
    })) as any[])[0];
    if (row?.ts == null) {
        const exists = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [id] })) as any[])[0];
        if (!exists) return Response.json({ error: "not_found", message: "Agent not found" }, { status: 404 });
    }
    const seenAt = await ctx.fns.auth.markSeen({ agentId: id });
    return Response.json({ version: 1, ok: true, agentId: id, seenAt });
}
