/**
 * Reads progress or the completed result of a shared context-agent task
 *
 * Returns the durable status, summary, and JSON-compatible result for a child created by sharedAgent.delegate. Use to poll asynchronous delegated work without opening the child transcript.
 * @param opts.childId Delegated child identifier returned by sharedAgent.delegate.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Delegated child identifier returned by sharedAgent.delegate. */
        childId: string;
    },
): Promise<{ childId: string; status: string; summary: string | null; result: any | null; updatedAt: number }> {
    const childId = String(opts.childId ?? "").trim();
    if (!childId) throw new Error("sharedAgent.result: childId is required");
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT scratchpad, updated_at FROM agents WHERE id = ?", params: [childId] }) as any[];
    if (!rows.length) throw new Error("sharedAgent.result: task not found: " + childId);
    let scratchpad: any = rows[0].scratchpad ?? {};
    if (typeof scratchpad === "string") { try { scratchpad = JSON.parse(scratchpad); } catch { scratchpad = {}; } }
    if (!scratchpad.sharedAgentTask) throw new Error("sharedAgent.result: not a shared-agent task");
    const meta = scratchpad.delegation ?? {};
    return { childId, status: String(meta.status ?? "working"), summary: meta.summary == null ? null : String(meta.summary), result: meta.result?.result ?? null, updatedAt: Number(rows[0].updated_at ?? 0) };
}
