/**
 * Brings a closed canvas tab back, with the args and state it had, as the active tab.
 *
 * Closing a tab only marks it closed; find one with canvas.list({ closed: true }) and pass its id. The tab
 * returns at the end of the strip and the canvas opens. Reopening an open tab just switches to it.
 * @param opts.itemId Closed (or open) tab to show again.
 * @param opts.agentId Agent whose canvas it is. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Closed (or open) tab to show again. */
    itemId: number;
    /** Agent whose canvas it is. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const itemId = Number(opts.itemId);
    await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const row = ((await ctx.fns.procs.db.select({ sql: "SELECT closed_at FROM canvas_items WHERE id = ? AND agent_id = ?", params: [itemId, agentId] })) as any[])[0];
            if (!row) throw new Error(`canvas.reopen: no tab ${opts.itemId} on ${agentId}'s canvas (closed tabs are kept 30 days)`);
            const now = Date.now();
            if (row.closed_at != null) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET closed_at = NULL, updated_at = ?, position = (SELECT COALESCE(MIN(position), 1) - 1 FROM canvas_items WHERE agent_id = ? AND closed_at IS NULL) WHERE id = ?", params: [now, agentId, itemId] });
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [itemId, now, agentId] });
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET shown_at = ? WHERE id = ?", params: [now, itemId] });
            return null;
        },
    });
    return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId)!;
}
