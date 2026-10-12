/**
 * Closes one tab on an agent's canvas.
 *
 * When the active tab closes, its neighbour becomes active; the canvas itself stays open (empty when it
 * was the last tab). Every open page of that chat follows at once.
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
            await ctx.fns.procs.db.run({ sql: "DELETE FROM canvas_items WHERE id = ? AND agent_id = ?", params: [items[at]!.id, agentId] });
            const rest = items.filter((_, i) => i !== at);
            const active = items[at]!.active ? (rest[Math.min(at, rest.length - 1)]?.id ?? null) : (items.find(i => i.active)?.id ?? null);
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [active, Date.now(), agentId] });
            return { closed: true, activeItemId: active };
        },
    })) as { closed: boolean; activeItemId: number | null };
}
