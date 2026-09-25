/**
 * Removes a session from the shared context-agent registry
 *
 * Revokes discovery and future delegation for a previously published session while leaving the original session and existing delegated children intact.
 * @param opts.agentId Published source agent session identifier.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Published source agent session identifier. */
        agentId: string;
    },
): Promise<{ ok: true; agentId: string }> {
    const agentId = String(opts.agentId ?? "").trim();
    if (!agentId) throw new Error("sharedAgent.unpublish: agentId is required");
    await ctx.fns.procs.db.run({ sql: "DELETE FROM kv WHERE key = ?", params: ["shared-agent:" + agentId] });
    return { ok: true as const, agentId };
}
