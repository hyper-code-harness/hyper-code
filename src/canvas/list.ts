/**
 * Lists the tabs open on an agent's canvas, in tab order (pinned first), marking the active one.
 *
 * Use to see what the canvas shows before switching, closing or updating a tab's state. With `closed: true`
 * it lists the recently closed tabs instead, newest first — closing only marks a tab, so it can be brought
 * back with canvas.reopen (closed tabs are kept 30 days).
 * @param opts.agentId Agent whose canvas to list. @default the current agent
 * @param opts.closed List closed tabs (newest first) instead of open ones. @default false
 * @param opts.limit Most closed tabs to return. @default 20 @maximum 200
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to list. @default the current agent */
    agentId?: string;
    /** List closed tabs (newest first) instead of open ones. @default false */
    closed?: boolean;
    /** Most closed tabs to return. @default 20 @maximum 200 */
    limit?: number;
}): Promise<types.canvas.Item[]> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const view = await ctx.fns.canvas.get({ agentId });
    const cols = "id, kind, title, payload, state, created_at, updated_at, closed_at, pinned_at";
    const rows = (opts.closed
        ? await ctx.fns.procs.db.select({ sql: `SELECT ${cols} FROM canvas_items WHERE agent_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC, id DESC LIMIT ?`, params: [agentId, Math.min(200, Math.max(1, Math.floor(Number(opts.limit) || 20)))] })
        : await ctx.fns.procs.db.select({ sql: `SELECT ${cols} FROM canvas_items WHERE agent_id = ? AND closed_at IS NULL ORDER BY (pinned_at IS NULL), position, id`, params: [agentId] })) as any[];
    return rows.map(r => ({
        id: Number(r.id), agentId, kind: String(r.kind), title: String(r.title ?? ""),
        args: json(r.payload), state: json(r.state), active: !opts.closed && Number(r.id) === view.activeItemId,
        createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), pinned: r.pinned_at != null, closedAt: r.closed_at == null ? null : Number(r.closed_at),
    }));
}

function json(value: unknown): Record<string, any> {
    if (typeof value === "string") { try { return JSON.parse(value) ?? {}; } catch { return {}; } }
    return (value && typeof value === "object" ? value : {}) as Record<string, any>;
}
