/**
 * Pins or unpins one tab on an agent's canvas.
 *
 * A pinned tab stays at the left of the tab strip, drawn as its icon only and without a close button, so a
 * page the person keeps coming back to (tests, a dashboard, a table) is always one click away; new tabs open
 * to the right of the pinned ones. Pinning keeps the tab's place among the pinned tabs at the end of that
 * group; unpinning puts it first among the others. Every open page of that chat follows at once.
 * @param opts.itemId Tab to pin or unpin (from canvas.list or canvas.show).
 * @param opts.pinned Pin (true) or unpin (false). @default true
 * @param opts.agentId Agent whose canvas it is. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to pin or unpin (from canvas.list or canvas.show). */
    itemId: number;
    /** Pin (true) or unpin (false). @default true */
    pinned?: boolean;
    /** Agent whose canvas it is. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const itemId = Number(opts.itemId);
    const pinned = opts.pinned !== false;
    await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const items = await ctx.fns.canvas.list({ agentId });
            const item = items.find(i => i.id === itemId);
            if (!item) throw new Error(`canvas.pin: no open tab ${opts.itemId} on ${agentId}'s canvas`);
            if (item.pinned === pinned) return null;
            const order = items.filter(i => i.id !== itemId);
            const pins = order.filter(i => i.pinned).length;
            // Pinned: last of the pinned group. Unpinned: first of the rest — next to where it was.
            order.splice(pins, 0, item);
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET pinned_at = ?, updated_at = ? WHERE id = ? AND agent_id = ?", params: [pinned ? Date.now() : null, Date.now(), itemId, agentId] });
            await renumber(ctx, agentId, order.map(i => i.id));
            return null;
        },
    });
    return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId)!;
}

async function renumber(ctx: Context, agentId: string, ids: number[]): Promise<void> {
    if (!ids.length) return;
    await ctx.fns.procs.db.run({
        sql: `UPDATE canvas_items AS c SET position = o.n FROM (SELECT * FROM unnest(?::bigint[]) WITH ORDINALITY AS t(id, n)) AS o WHERE c.id = o.id AND c.agent_id = ?`,
        params: [`{${ids.join(",")}}`, agentId],
    });
}
