/**
 * Fingerprints what an agent's canvas panel shows, so pages refetch it only when it really changed.
 *
 * `panel` covers the tab strip (ids, titles, kinds, active tab), the recently-closed menu and the active body; `body` covers only the
 * active tab's kind, args and state — when it is unchanged a page keeps its live body (the framed file keeps
 * its scroll and unsaved edits) and swaps just the strip.
 * @param opts.agentId Agent whose canvas to fingerprint.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to fingerprint. */
    agentId: string;
}): Promise<{ panel: string; body: string; activeItemId: number | null; tabs: number[] }> {
    const [items, closed] = await Promise.all([ctx.fns.canvas.list({ agentId: opts.agentId }), ctx.fns.canvas.list({ agentId: opts.agentId, closed: true, limit: 15 })]);
    const active = items.find(i => i.active) ?? null;
    const hash = (value: unknown) => Bun.hash(JSON.stringify(value)).toString(36);
    // A live-state kind gets its state posted in, so a state change must not replace its body.
    const live = !!active && !!((ctx.state as any).canvas?.kinds?.[active.kind] as types.canvas.Registered | undefined)?.liveState;
    const body = hash(active ? [active.id, active.kind, active.args, live ? null : active.state] : null);
    return { panel: hash([items.map(i => [i.id, i.kind, i.title, i.active]), closed.map(i => [i.id, i.title, i.closedAt]), body, active?.state ?? null]), body, activeItemId: active?.id ?? null, tabs: items.map(i => i.id) };
}
