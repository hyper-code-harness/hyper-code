/**
 * Moves one tab on an agent's canvas to another place in the tab strip, pinning or unpinning it on the way.
 *
 * Use for drag and drop of tabs, or when a tab should stand next to another. `before` names the tab it lands in
 * front of; omit it (or pass null) to move the tab to the end. Dropped among the pinned tabs it becomes pinned,
 * among the others unpinned — the strip always keeps the pinned group at the left. Every open page of that
 * chat follows at once.
 * @param opts.itemId Tab to move (from canvas.list or canvas.show).
 * @param opts.before Tab it lands in front of; null or omitted for the end of the strip.
 * @param opts.pinned Force the pinned state instead of deriving it from the place (dropping at the very edge between the groups).
 * @param opts.agentId Agent whose canvas it is. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to move (from canvas.list or canvas.show). */
    itemId: number;
    /** Tab it lands in front of; null or omitted for the end of the strip. */
    before?: number | null;
    /** Force the pinned state instead of deriving it from the place (dropping at the very edge between the groups). */
    pinned?: boolean;
    /** Agent whose canvas it is. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item[]> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const itemId = Number(opts.itemId);
    const before = opts.before == null ? null : Number(opts.before);
    await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const items = await ctx.fns.canvas.list({ agentId });
            const item = items.find(i => i.id === itemId);
            if (!item) throw new Error(`canvas.move: no open tab ${opts.itemId} on ${agentId}'s canvas`);
            if (before === itemId) return null;
            const order = items.filter(i => i.id !== itemId);
            let at = before == null ? order.length : order.findIndex(i => i.id === before);
            if (at < 0) throw new Error(`canvas.move: no open tab ${before} on ${agentId}'s canvas to move in front of`);
            // The place decides the group: in front of a pinned tab → pinned; behind the last pinned one →
            // unpinned, unless the caller says otherwise. The group stays contiguous either way.
            const pins = order.filter(i => i.pinned).length;
            const pinned = typeof opts.pinned === "boolean" ? opts.pinned : at < pins;
            at = pinned ? Math.min(at, pins) : Math.max(at, pins);
            order.splice(at, 0, { ...item, pinned });
            if (pinned !== item.pinned) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET pinned_at = ? WHERE id = ? AND agent_id = ?", params: [pinned ? Date.now() : null, itemId, agentId] });
            await ctx.fns.procs.db.run({
                sql: `UPDATE canvas_items AS c SET position = o.n, updated_at = c.updated_at FROM (SELECT * FROM unnest(?::bigint[]) WITH ORDINALITY AS t(id, n)) AS o WHERE c.id = o.id AND c.agent_id = ?`,
                params: [`{${order.map(i => i.id).join(",")}}`, agentId],
            });
            return null;
        },
    });
    return ctx.fns.canvas.list({ agentId });
}
