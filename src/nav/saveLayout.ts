/**
 * Saves or resets the current person's own global menu (⌘/) layout (setting nav.layout, scope user).
 *
 * Tabs need an id; any id but the built-in `home` / `plugins` needs a title. Placements need a known widget; ids are made
 * unique within a tab. Unknown hidden / searchHidden ids are dropped. Pass `reset: true` to delete the
 * person's layout so the instance layout applies again. Without a signed-in person (open single-user
 * instance) the instance layout is written instead.
 * @param opts.layout New layout; ignored when reset is true.
 * @param opts.reset Delete the person's layout instead of saving one. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** New layout; ignored when reset is true. */
        layout?: types.nav.Layout;
        /** Delete the person's layout instead of saving one. @default false */
        reset?: boolean;
    },
): Promise<{ scope: "user" | "global"; layout: types.nav.Layout | null }> {
    const userId = await ctx.fns.auth.viewerId({}).catch(() => null);
    const scope = userId ? { scopeType: "user", scopeId: userId } : { scopeType: "global", scopeId: "" };
    if (opts.reset) {
        await ctx.fns.settings.remove({ module: "nav", key: "layout", ...scope });
        return { scope: userId ? "user" : "global", layout: null };
    }
    const state = ((ctx.state as any).nav ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const declared: Record<string, true> = { home: true, plugins: true };
    const widgets = state.widgets ?? {};
    const sources = state.search ?? {};
    const sizes = new Set(["S", "M", "L", "wide", "tall"]);
    const seen = new Set<string>();
    const tabs = (opts.layout?.tabs ?? []).flatMap((t: any) => {
        const id = String(t?.id ?? "").trim();
        if (!/^[A-Za-z0-9_.:-]+$/.test(id) || seen.has(id)) return [];
        if (!declared[id] && !String(t.title ?? "").trim()) return [];
        seen.add(id);
        const out: { id: string } & Partial<types.nav.Tab> = { id };
        if (t.title !== undefined) out.title = String(t.title);
        if (t.icon !== undefined && /^ph-[a-z0-9-]+$/.test(String(t.icon))) out.icon = String(t.icon);
        if (Array.isArray(t.widgets)) {
            const ids = new Set<string>();
            out.widgets = t.widgets.flatMap((p: any): types.nav.Placement[] => {
                if (!widgets[String(p?.widget ?? "")]) return [];
                let pid = String(p.id || p.widget);
                for (let n = 2; ids.has(pid); n++) pid = `${p.id || p.widget}-${n}`;
                ids.add(pid);
                return [{ id: pid, widget: String(p.widget), ...(sizes.has(p.size) ? { size: p.size } : {}), ...(p.config && typeof p.config === "object" && !Array.isArray(p.config) ? { config: p.config } : {}) }];
            });
        }
        if (Array.isArray(t.search)) out.search = t.search.map(String).filter((s: string) => sources[s]);
        return [out];
    });
    const known = (ids: unknown, ok: (id: string) => boolean) => [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(ok))];
    const layout: types.nav.Layout = { version: 1, tabs, hidden: known(opts.layout?.hidden, id => !!declared[id] || seen.has(id)), widgetsHidden: known(opts.layout?.widgetsHidden, id => !!widgets[id]), searchHidden: known(opts.layout?.searchHidden, id => !!sources[id]) };
    await ctx.fns.settings.set({ module: "nav", key: "layout", ...scope, value: JSON.stringify(layout) });
    return { scope: userId ? "user" : "global", layout };
}
