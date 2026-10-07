/**
 * Counts the current viewer’s unread mentions in each chat
 *
 * Returns unread @mention counts grouped by agent for mobile and other navigation clients that need per-chat mention badges.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<Record<string, number>> {
    const userId = await ctx.fns.auth.viewerId({});
        if (!userId) return {};
        const rows = await ctx.fns.procs.db.select({
            sql: "SELECT agent_id, count(*)::int AS n FROM mentions WHERE to_user = ? AND read_at IS NULL GROUP BY agent_id",
            params: [userId],
        }) as any[];
        return Object.fromEntries(rows.map((row) => [String(row.agent_id), Number(row.n ?? 0)]));
}
