/**
 * Opens something on an agent's canvas as a new active tab and shows the canvas.
 *
 * Use to put a file, a document or any other catalog kind (canvas.kinds) in front of the person, beside
 * the chat. The kind checks and normalises its args; the tab persists with the agent across reloads, and
 * every open page of that chat follows at once. Showing the same kind with the same args again just
 * switches to the existing tab.
 * @param opts.kind Canvas kind from the catalog, e.g. file.
 * @param opts.args Arguments of that kind, e.g. { path } for file.
 * @param opts.title Tab title; defaults to the kind's suggestion.
 * @param opts.agentId Agent whose canvas to use. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Canvas kind from the catalog, e.g. file. */
    kind: string;
    /** Arguments of that kind, e.g. { path } for file. */
    args?: Record<string, any>;
    /** Tab title; defaults to the kind's suggestion. */
    title?: string;
    /** Agent whose canvas to use. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const kind = ((ctx.state as any).canvas?.kinds ?? {})[opts.kind] as types.canvas.Registered | undefined;
    if (!kind) throw new Error(`canvas.show: unknown kind "${opts.kind}" — loaded: ${ctx.fns.canvas.kinds({}).map(k => k.name).join(", ") || "none"}`);
    const prepared = kind.prepare ? await kind.prepare(ctx, { agentId, args: opts.args ?? {} }) : { args: opts.args ?? {} };
    const title = String(opts.title ?? prepared.title ?? opts.kind).slice(0, 200);
    const payload = JSON.stringify(prepared.args ?? {});

    // Lookup and insert under the agent's canvas lock: two identical shows make one tab.
    const id = (await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const same = (await ctx.fns.procs.db.select({ sql: "SELECT id FROM canvas_items WHERE agent_id = ? AND kind = ? AND payload = ?::jsonb ORDER BY id LIMIT 1", params: [agentId, opts.kind, payload] })) as any[];
            const now = Date.now();
            let itemId: number;
            if (same[0]) {
                itemId = Number(same[0].id);
                if (opts.title) await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET title = ?, updated_at = ? WHERE id = ?", params: [title, now, itemId] });
            } else {
                const pos = (await ctx.fns.procs.db.select({ sql: "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM canvas_items WHERE agent_id = ?", params: [agentId] })) as any[];
                const row: any = await ctx.fns.procs.db.insert({ into: "canvas_items", values: { agent_id: agentId, kind: opts.kind, title, payload, position: Number(pos[0]?.p ?? 0), created_at: now, updated_at: now } });
                itemId = Number(row.id);
            }
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_state SET open = true, active_item_id = ?, updated_at = ? WHERE agent_id = ?", params: [itemId, now, agentId] });
            return itemId;
        },
    })) as number;
    return (await ctx.fns.canvas.list({ agentId })).find(i => i.id === id)!;
}
