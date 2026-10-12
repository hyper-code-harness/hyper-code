/**
 * Fingerprints what an agent's canvas panel shows, so pages refetch it only when it really changed.
 *
 * `panel` covers the tab strip (ids, titles, kinds, active tab) and the active body; `body` covers only the
 * active tab's kind, args and state — when it is unchanged a page keeps its live body (the framed file keeps
 * its scroll and unsaved edits) and swaps just the strip.
 * @param opts.agentId Agent whose canvas to fingerprint.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to fingerprint. */
    agentId: string;
}): Promise<{ panel: string; body: string; activeItemId: number | null; tabs: number[] }> {
    const items = await ctx.fns.canvas.list({ agentId: opts.agentId });
    const active = items.find(i => i.active) ?? null;
    const hash = (value: unknown) => Bun.hash(JSON.stringify(value)).toString(36);
    const body = hash(active ? [active.id, active.kind, active.args, active.state] : null);
    return { panel: hash([items.map(i => [i.id, i.kind, i.title, i.active]), body]), body, activeItemId: active?.id ?? null, tabs: items.map(i => i.id) };
}
