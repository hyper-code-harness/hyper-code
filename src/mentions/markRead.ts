/**
 * Marks a person's @mentions read: in one chat, or one mention, or all.
 *
 * auth.markSeen calls it with the chat id whenever that person opens or watches the chat, so opening the
 * chat is what reads its mentions. Defaults to the current viewer.
 * @param opts.agentId Only mentions in this chat.
 * @param opts.id Only this mention.
 * @param opts.userId Mentioned person; defaults to the current viewer.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Only mentions in this chat. */
        agentId?: string;
        /** Only this mention. */
        id?: number;
        /** Mentioned person; defaults to the current viewer. */
        userId?: string;
    },
): Promise<{ read: number }> {
    const userId = opts.userId ?? await ctx.fns.auth.viewerId({});
    if (!userId) return { read: 0 };
    const where = ["to_user = ?", "read_at IS NULL"];
    const params: any[] = [Date.now(), userId];
    if (opts.agentId) { where.push("agent_id = ?"); params.push(opts.agentId); }
    if (opts.id != null) { where.push("id = ?"); params.push(opts.id); }
    const res = await ctx.fns.procs.db.run({ sql: `UPDATE mentions SET read_at = ? WHERE ${where.join(" AND ")} RETURNING id`, params });
    const read = (res.rows as any[])?.length ?? 0;
    if (read) ctx.fns.procs.events.emit({ event: { type: "mentions.changed", to: [userId] } });
    return { read };
}
