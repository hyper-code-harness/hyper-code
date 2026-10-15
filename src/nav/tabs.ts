/**
 * Lists the global menu (⌘/) tabs of the current viewer in display order, each resolved to its widget
 * placements and search sources.
 *
 * Built-in tabs: `home` with the core widgets (chats, shared, pages, projects) and `plugins`, with the pages plugins declare
 * (pluginPages) followed by every plugin widget (module other than nav) the layout does not place on any tab nor list in widgetsHidden — shown only when it has
 * something. Both ask every search source unless the layout narrows them. The effective layout (nav.layout) lists tabs in order: an entry with id `home` or `plugins`
 * overrides that built-in tab's fields, any other id with a title is the person's own tab; built-in tabs not
 * listed go first; layout.hidden tabs are left out. Placements of unknown widgets are dropped and a size the widget does not declare falls back
 * to its first size; `search` keeps only known sources not in layout.searchHidden (omitted = every source).
 * Use to inspect or test what the menu will show.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<{ tabs: Array<types.nav.Tab & { id: string; widgets: types.nav.Placement[]; search: string[] }>; source: "user" | "instance" | "default" }> {
    const { layout, source } = await ctx.fns.nav.effectiveLayout({});
    const state = ((ctx.state as any).nav ?? {}) as {
        widgets?: Record<string, types.nav.Widget & types.nav.Registered>;
        search?: Record<string, types.nav.Search & types.nav.Registered>;
    };
    const widgets = state.widgets ?? {};
    // Plugin widgets (any module but nav) the layout does not place on some tab land on the built-in
    // Plugins tab, so a newly mounted plugin shows up without anyone editing a layout.
    // (Placements stored on the plugins tab itself do not count: a widget moved to another tab leaves it.)
    const placedAnywhere = new Set((layout.tabs ?? []).filter(t => t.id !== "plugins").flatMap(t => (Array.isArray(t.widgets) ? t.widgets : []).map((w: any) => String(w?.widget ?? ""))));
    const widgetsHidden = new Set(layout.widgetsHidden ?? []);
    const unplaced = Object.values(widgets).filter(w => w.module !== "nav" && !placedAnywhere.has(w.id) && !widgetsHidden.has(w.id))
        .sort((a, b) => a.module.localeCompare(b.module) || a.id.localeCompare(b.id));
    const declared: Record<string, types.nav.Tab & { id: string }> = {
        home: { id: "home", title: "Home", icon: "ph-house", order: 0, widgets: ["chats", "pages"].map(w => ({ id: w, widget: w, size: "tall" as const })) },
        plugins: { id: "plugins", title: "Plugins", icon: "ph-plugs", order: 1, widgets: widgets.pluginPages ? [{ id: "pluginPages", widget: "pluginPages", size: "wide" }] : [] },
    };
    const sources = state.search ?? {};
    const hidden = new Set(layout.hidden ?? []);
    const searchHidden = new Set(layout.searchHidden ?? []);
    const allSources = Object.keys(sources).filter(id => !searchHidden.has(id));
    const byOrder = (a: { id: string; order?: number }, b: { id: string; order?: number }) => Number(a.order ?? 100) - Number(b.order ?? 100) || a.id.localeCompare(b.id);

    const listed: Array<{ id: string } & Partial<types.nav.Tab>> = [];
    const seen = new Set<string>();
    for (const t of layout.tabs ?? []) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        listed.push(declared[t.id] ? { ...declared[t.id], ...t } : t);
    }
    const rest = Object.values(declared).filter(t => !seen.has(t.id)).sort(byOrder);
    const resolve = (t: { id: string } & Partial<types.nav.Tab>) => {
        const ids = new Set<string>();
        const own = (Array.isArray(t.widgets) ? t.widgets : []).filter((p: any) => t.id !== "plugins" || !placedAnywhere.has(String(p?.widget ?? "")));
        const auto = t.id === "plugins" ? unplaced.filter(w => !own.some((p: any) => p?.widget === w.id)).map(w => ({ id: w.id, widget: w.id })) : [];
        const placed = [...own, ...auto].flatMap((p: any): types.nav.Placement[] => {
            const w = widgets[String(p?.widget ?? "")];
            if (!w) return [];
            let id = String(p.id || p.widget);
            for (let n = 2; ids.has(id); n++) id = `${p.id || p.widget}-${n}`;
            ids.add(id);
            const sizes = w.sizes?.length ? w.sizes : ["M" as const];
            const size = sizes.includes(p.size) ? p.size : sizes[0]!;
            return [{ id, widget: w.id, size, ...(p.config && typeof p.config === "object" ? { config: p.config } : {}) }];
        });
        const search = Array.isArray(t.search) ? t.search.filter(id => sources[id] && !searchHidden.has(id)) : allSources;
        return { ...t, id: t.id, title: String(t.title ?? t.id), widgets: placed, search };
    };
    const tabs = [...rest, ...listed].filter(t => !hidden.has(t.id) && (declared[t.id] || String(t.title ?? "").trim())).map(resolve)
        // An empty built-in Plugins tab (no plugin widgets at all) is not worth a tab.
        .filter(t => t.id !== "plugins" || t.widgets.length > 0);
    return { tabs, source };
}
