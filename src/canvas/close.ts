/**
 * Closes one tab on an agent's canvas.
 *
 * When the active tab closes, its neighbour becomes active; the canvas itself stays open (empty when it
 * was the last tab). Every open page of that chat follows at once. The tab is only marked closed, with its
 * args and state kept: canvas.list({ closed: true }) finds it and canvas.reopen brings it back; closed tabs
 * older than 30 days are deleted.
 * @param opts.itemId Tab to close (from canvas.list or canvas.show).
 * @param opts.agentId Agent whose canvas it is. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab to close (from canvas.list or canvas.show). */
    itemId: number;
    /** Agent whose canvas it is. @default the current agent */
    agentId?: string;
}): Promise<{ closed: boolean; activeItemId: number | null }> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    // Under the lock the list is fresh, so concurrent closes never pick an already-deleted neighbour.
    return (await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const items = await ctx.fns.canvas.list({ agentId });
            const at = items.findIndex(i => i.id === Number(opts.itemId));
            if (at < 0) return { closed: false, activeItemId: items.find(i => i.active)?.id ?? null };
            const now = Date.now();
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET closed_at = ? WHERE id = ? AND agent_id = ?", params: [now, items[at]!.id, agentId] });
            await ctx.fns.procs.db.run({ sql: "DELETE FROM canvas_items WHERE agent_id = ? AND closed_at < ?", params: [agentId, now - 30 * 86_400_000] });
            const rest = items.filter((_, i) => i !== at);
            const active = items[at]!.active ? (rest[Math.min(at, rest.length - 1)]?.id ?? null) : (items.find(i => i.active)?.id ?? null);
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [active, Date.now(), agentId] });
            return { closed: true, activeItemId: active };
        },
    })) as { closed: boolean; activeItemId: number | null };
}
