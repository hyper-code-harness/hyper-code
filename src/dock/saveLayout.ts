/**
 * Saves or resets the current person's own Dock layout (setting dock.layout, scope user).
 *
 * Unknown ids and the fixed `menu` / `me` entries are dropped; an id listed twice keeps its first place.
 * Pass `reset: true` to delete the person's layout so the instance layout applies again. Without a
 * signed-in person (open single-user instance) the instance layout is written instead.
 * @param opts.layout New layout; ignored when reset is true.
 * @param opts.reset Delete the person's layout instead of saving one. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** New layout; ignored when reset is true. */
        layout?: types.dock.Layout;
        /** Delete the person's layout instead of saving one. @default false */
        reset?: boolean;
    },
): Promise<{ scope: "user" | "global"; layout: types.dock.Layout | null }> {
    const userId = await ctx.fns.auth.viewerId({}).catch(() => null);
    const scope = userId ? { scopeType: "user", scopeId: userId } : { scopeType: "global", scopeId: "" };
    if (opts.reset) {
        await ctx.fns.settings.remove({ module: "dock", key: "layout", ...scope });
        return { scope: userId ? "user" : "global", layout: null };
    }
    const known = new Set(Object.keys((ctx.state as any).dock?.items ?? {}));
    const seen = new Set<string>();
    const clean = (list: unknown) => (Array.isArray(list) ? list : []).map(String).filter(id => known.has(id) && !seen.has(id) && (seen.add(id), true));
    const top = clean(opts.layout?.top);
    const bottom = clean(opts.layout?.bottom);
    const hidden = clean(opts.layout?.hidden);
    const layout: types.dock.Layout = { top, bottom, hidden };
    await ctx.fns.settings.set({ module: "dock", key: "layout", ...scope, value: JSON.stringify(layout) });
    return { scope: userId ? "user" : "global", layout };
}
