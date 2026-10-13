/**
 * Points an open url canvas tab at another web address in place
 *
 * Re-checks the new address the same way canvas.show does for the url kind (normalises it, checks whether the site allows framing) and updates that tab's address and title, keeping the tab, its position and its state. Use for the canvas address bar, or when the person's current web tab should show another page instead of opening a new tab. Only url tabs can be navigated.
 * @param opts.itemId Url tab to navigate (from canvas.list or canvas.show).
 * @param opts.url New address; http/https, a bare host like example.com gets https://.
 * @param opts.agentId Agent whose canvas it is; defaults to the current agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Url tab to navigate (from canvas.list or canvas.show). */
        itemId: number;
        /** New address; http/https, a bare host like example.com gets https://. */
        url: string;
        /** Agent whose canvas it is; defaults to the current agent. */
        agentId?: string;
    },
): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
        const kind = ((ctx.state as any).canvas?.kinds ?? {}).url as types.canvas.Registered | undefined;
        if (!kind?.prepare) throw new Error("canvas.navigate: the url kind is not loaded");
        const prepared = await kind.prepare(ctx, { agentId, args: { url: opts.url } });
        const itemId = Number(opts.itemId);
        await ctx.fns.canvas.locked({
            agentId,
            fn: async () => {
                const row = (await ctx.fns.procs.db.select({ sql: "SELECT kind FROM canvas_items WHERE id = ? AND agent_id = ? AND closed_at IS NULL", params: [itemId, agentId] })) as any[];
                if (!row.length) throw new Error(`canvas.navigate: no tab ${itemId} on ${agentId}'s canvas`);
                if (row[0].kind !== "url") throw new Error(`canvas.navigate: tab ${itemId} is a ${row[0].kind} tab — only url tabs navigate`);
                const now = Date.now();
                await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET payload = ?::jsonb, title = ?, updated_at = ? WHERE id = ?", params: [JSON.stringify(prepared.args), String(prepared.title ?? "page").slice(0, 200), now, itemId] });
                await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [itemId, now, agentId] });
            },
        });
        return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId)!;
}
