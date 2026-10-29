/**
 * Puts away the least recently shown unpinned tabs of an agent's canvas once there are more than `canvas.maxTabs`.
 *
 * Called by canvas.show after it opens a tab, inside the agent's canvas lock (this function takes no lock of its
 * own, so call it inside canvas.locked). A tab put away is only marked closed with its args and state kept:
 * it is listed under Recently closed and canvas.reopen brings it back. Pinned tabs, the active tab and `keep`
 * are never put away. A tab never shown counts from when it was opened.
 * @param opts.agentId Agent whose canvas to tidy.
 * @param opts.keep A tab that must stay (the one just opened).
 * @param opts.max Most unpinned tabs to keep. @default setting canvas.maxTabs (12; 0 turns tidying off)
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to tidy. */
    agentId: string;
    /** A tab that must stay (the one just opened). */
    keep?: number;
    /** Most unpinned tabs to keep. @default setting canvas.maxTabs (12; 0 turns tidying off) */
    max?: number;
}): Promise<{ closed: number[] }> {
    const max = Math.floor(Number(opts.max ?? (await ctx.fns.settings.getNumber({ module: "canvas", scopeType: "global", key: "maxTabs", fallback: 12 }))));
    if (!(max > 0)) return { closed: [] };
    const rows = (await ctx.fns.procs.db.select({
        sql: `SELECT c.id FROM canvas_items c LEFT JOIN canvas_state s ON s.agent_id = c.agent_id
              WHERE c.agent_id = ? AND c.closed_at IS NULL AND c.pinned_at IS NULL
                AND c.id IS DISTINCT FROM s.active_item_id AND c.id <> ?
              ORDER BY COALESCE(c.shown_at, c.created_at) DESC, c.id DESC OFFSET ?`,
        params: [opts.agentId, Number(opts.keep ?? -1), Math.max(0, max - 1)],
    })) as Array<{ id: number }>;
    // max - 1 others: `keep` (or the active tab) is the max-th.
    const ids = rows.map(r => Number(r.id));
    if (ids.length) await ctx.fns.procs.db.run({ sql: `UPDATE canvas_items SET closed_at = ? WHERE agent_id = ? AND id = ANY(?::bigint[])`, params: [Date.now(), opts.agentId, `{${ids.join(",")}}`] });
    return { closed: ids };
}
