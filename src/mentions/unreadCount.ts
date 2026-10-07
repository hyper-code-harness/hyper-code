/**
 * Counts a person's unread @mentions.
 *
 * Defaults to the person viewing the page; 0 when nobody is identified.
 * @param opts.userId Mentioned person; defaults to the current viewer.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Mentioned person; defaults to the current viewer. */
        userId?: string;
    },
): Promise<number> {
    const userId = opts.userId ?? await ctx.fns.auth.viewerId({});
    if (!userId) return 0;
    const row = (await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int AS n FROM mentions WHERE to_user = ? AND read_at IS NULL", params: [userId] }) as any[])[0];
    return Number(row?.n ?? 0);
}
