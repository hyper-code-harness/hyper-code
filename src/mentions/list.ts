/**
 * Lists mentions (@id) of a person, newest first, with chat title and author.
 *
 * Defaults to the person viewing the page. Use unreadOnly for the badge popup and the global menu.
 * @param opts.userId Mentioned person; defaults to the current viewer.
 * @param opts.unreadOnly Only mentions not read yet.
 * @param opts.limit Maximum rows to return.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Mentioned person; defaults to the current viewer. */
        userId?: string;
        /** Only mentions not read yet. @default false */
        unreadOnly?: boolean;
        /** Maximum rows to return. @default 30 @minimum 1 @maximum 200 */
        limit?: number;
    },
): Promise<Array<{ id: number; agentId: string; agentTitle: string | null; messageIdx: number; from: string | null; excerpt: string; createdAt: number; readAt: number | null }>> {
    const userId = opts.userId ?? await ctx.fns.auth.viewerId({});
    if (!userId) return [];
    const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 30)));
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT m.id, m.agent_id, a.title, m.message_idx, m.from_actor, m.excerpt, m.created_at, m.read_at
                FROM mentions m LEFT JOIN agents a ON a.id = m.agent_id
               WHERE m.to_user = ? ${opts.unreadOnly ? "AND m.read_at IS NULL" : ""}
               ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
        params: [userId, limit],
    }) as any[];
    return rows.map((r) => ({
        id: Number(r.id), agentId: String(r.agent_id), agentTitle: r.title ?? null, messageIdx: Number(r.message_idx),
        from: r.from_actor ?? null, excerpt: String(r.excerpt ?? ""), createdAt: Number(r.created_at), readAt: r.read_at == null ? null : Number(r.read_at),
    }));
}
