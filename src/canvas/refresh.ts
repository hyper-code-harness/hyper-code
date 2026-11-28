/**
 * Draws a canvas tab again on every open page of the chat
 *
 * Use after you changed the data behind a tab that does not follow it by itself (a page that is not a @live view, a framed app, a file rewritten outside Hyper): the tab's body is rendered again from its source, on every page of that chat, hidden ones when they come back. Bumps the tab's version, which is part of the panel fingerprint (canvas.revision), so pages refetch it. A tab that is not the open one needs nothing — it is drawn fresh when it is shown — but refreshing it is harmless. The tab's args, state, title and place stay as they are.
 * @param opts.itemId Tab to draw again (from canvas.list or canvas.show). Defaults to the open tab.
 * @param opts.agentId Agent whose canvas it is. Defaults to the current agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Tab to draw again (from canvas.list or canvas.show). Defaults to the open tab. */
        itemId?: number;
        /** Agent whose canvas it is. Defaults to the current agent. */
        agentId?: string;
    },
): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
        const itemId = (await ctx.fns.canvas.locked({
            agentId,
            fn: async () => {
                const id = opts.itemId != null ? Number(opts.itemId) : (await ctx.fns.canvas.get({ agentId })).activeItemId;
                if (id == null) throw new Error(`canvas.refresh: ${agentId}'s canvas has no open tab`);
                const done = await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET version = version + 1 WHERE id = ? AND agent_id = ? AND closed_at IS NULL RETURNING id", params: [id, agentId] });
                if (!done.rows?.length) throw new Error(`canvas.refresh: no open tab ${id} on ${agentId}'s canvas`);
                return id;
            },
        })) as number;
        return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId)!;
}
