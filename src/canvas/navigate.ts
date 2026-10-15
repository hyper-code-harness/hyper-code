/**
 * Points an open url or file canvas tab at another address in place
 *
 * For a url tab, re-checks the new address the same way canvas.show does (normalises it, checks whether the site allows framing). For a file tab, moves it to another file or directory (and Files view tab) after the same checks canvas.show makes. Either way the tab keeps its position and state and gets a new title. Use for the url address bar, for links clicked inside a file tab, or when the person's current tab should show something else instead of opening a new tab.
 * @param opts.itemId Url or file tab to navigate (from canvas.list or canvas.show).
 * @param opts.url New address for a url tab; http/https, a bare host like example.com gets https://.
 * @param opts.file New target for a file tab: path (absolute or workspace-relative), host alias, and the Files view tab.
 * @param opts.agentId Agent whose canvas it is; defaults to the current agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Url or file tab to navigate (from canvas.list or canvas.show). */
        itemId: number;
        /** New address for a url tab; http/https, a bare host like example.com gets https://. */
        url?: string;
        /** New target for a file tab: path (absolute or workspace-relative), host alias, and the Files view tab. */
        file?: { path: string; host?: string; tab?: "" | "preview" | "code" | "edit" };
        /** Agent whose canvas it is; defaults to the current agent. */
        agentId?: string;
    },
): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
        const target = opts.file ? "file" : "url";
        if (target === "url" && !opts.url) throw new Error("canvas.navigate: url or file is required");
        const kind = ((ctx.state as any).canvas?.kinds ?? {})[target] as types.canvas.Registered | undefined;
        if (!kind?.prepare) throw new Error(`canvas.navigate: the ${target} kind is not loaded`);
        const prepared = await kind.prepare(ctx, { agentId, args: opts.file ? { path: opts.file.path, host: opts.file.host, tab: opts.file.tab } : { url: opts.url } });
        const itemId = Number(opts.itemId);
        await ctx.fns.canvas.locked({
            agentId,
            fn: async () => {
                const row = (await ctx.fns.procs.db.select({ sql: "SELECT kind FROM canvas_items WHERE id = ? AND agent_id = ? AND closed_at IS NULL", params: [itemId, agentId] })) as any[];
                if (!row.length) throw new Error(`canvas.navigate: no tab ${itemId} on ${agentId}'s canvas`);
                if (row[0].kind !== target) throw new Error(`canvas.navigate: tab ${itemId} is a ${row[0].kind} tab, not a ${target} tab`);
                const now = Date.now();
                await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET payload = ?::jsonb, title = ?, updated_at = ? WHERE id = ?", params: [JSON.stringify(prepared.args), String(prepared.title ?? "page").slice(0, 200), now, itemId] });
                await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [itemId, now, agentId] });
            },
        });
        return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === itemId)!;
}
