/**
 * Fingerprints what an agent's canvas panel shows, so pages refetch it only when it really changed.
 *
 * `panel` covers the tab strip (ids, titles, kinds, active tab, pinned), the All tabs list and the active body; `body` covers only the
 * active tab's kind, args and state — when it is unchanged a page keeps its live body (the framed file keeps
 * its scroll and unsaved edits) and swaps just the strip.
 * @param opts.agentId Agent whose canvas to fingerprint.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to fingerprint. */
    agentId: string;
}): Promise<{ panel: string; body: string; activeItemId: number | null; tabs: number[] }> {
    const [items, closed] = await Promise.all([ctx.fns.canvas.list({ agentId: opts.agentId }), ctx.fns.canvas.list({ agentId: opts.agentId, closed: true, limit: 50 })]);
    const active = items.find(i => i.active) ?? null;
    const hash = (value: unknown) => Bun.hash(JSON.stringify(value)).toString(36);
    // A live-state kind gets its state posted in, so a state change must not replace its body.
    const live = !!active && !!((ctx.state as any).canvas?.kinds?.[active.kind] as types.canvas.Registered | undefined)?.liveState;
    // canvas.refresh bumps the tab's version: the body counts as changed and every page draws it again.
    const version = active ? Number(((await ctx.fns.procs.db.select({ sql: "SELECT version FROM canvas_items WHERE id = ?", params: [active.id] })) as any[])[0]?.version ?? 1) : 0;
    const body = hash(active ? [active.id, active.kind, active.args, live ? null : active.state, version] : null);
    // The strip shows which tabs are pinned, so pinning is part of the fingerprint (it was not: pinning the first
    // unpinned tab changes no order, and the page kept the old strip until a reload).
    return { panel: hash([items.map(i => [i.id, i.kind, i.title, i.active, i.pinned]), closed.map(i => [i.id, i.title, i.closedAt]), body, active?.state ?? null]), body, activeItemId: active?.id ?? null, tabs: items.map(i => i.id) };
}
