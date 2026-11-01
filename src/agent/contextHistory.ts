/**
 * Load the transcript an agent's model context is built from: the inherited parent prefix plus its own rows.
 *
 * Returns the history in the coordinates every compaction offset uses: for a fork, the parent's history up to fork_offset followed by the fork's own messages; for a root chat, its own messages. Use it wherever a compaction boundary (tailStart, sourceOffset) is computed or applied — compactContext, autoCompactIfNeeded, buildLlmRequest — so the number means the same position everywhere. `inherited` is the length of the parent prefix (0 for a root chat) and `ownRows` counts the agent's own persisted rows including excluded ones, the token compaction uses to detect concurrent writes.
 * @param opts.id Agent whose context history is loaded.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose context history is loaded. */
        id: string;
    },
): Promise<{ messages: any[]; inherited: number; ownRows: number }> {
    const row = ((await ctx.fns.procs.db.select({ sql: "SELECT parent_id, fork_offset, (SELECT COUNT(*) FROM messages WHERE agent_id = ?) AS own_rows FROM agents WHERE id = ?", params: [opts.id, opts.id] })) as any[])[0];
        if (!row) return { messages: [], inherited: 0, ownRows: 0 };
        const own = await ctx.fns.session.getMessages({ id: opts.id });
        const ownRows = Number(row.own_rows ?? 0);
        if (!row.parent_id) return { messages: own, inherited: 0, ownRows };
        const parent = await ctx.fns.session.getFullMessages({ id: String(row.parent_id) });
        const prefix = row.fork_offset == null ? parent : parent.slice(0, Number(row.fork_offset));
        return { messages: [...prefix, ...own], inherited: prefix.length, ownRows };
}
