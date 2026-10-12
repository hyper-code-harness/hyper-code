/**
 * Lists the tabs open on an agent's canvas, in tab order, marking the active one.
 *
 * Use to see what the canvas shows before switching, closing or updating a tab's state.
 * @param opts.agentId Agent whose canvas to list. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to list. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item[]> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const view = await ctx.fns.canvas.get({ agentId });
    const rows = (await ctx.fns.procs.db.select({ sql: "SELECT id, kind, title, payload, state FROM canvas_items WHERE agent_id = ? ORDER BY position, id", params: [agentId] })) as any[];
    return rows.map(r => ({
        id: Number(r.id), agentId, kind: String(r.kind), title: String(r.title ?? ""),
        args: json(r.payload), state: json(r.state), active: Number(r.id) === view.activeItemId,
    }));
}

function json(value: unknown): Record<string, any> {
    if (typeof value === "string") { try { return JSON.parse(value) ?? {}; } catch { return {}; } }
    return (value && typeof value === "object" ? value : {}) as Record<string, any>;
}
