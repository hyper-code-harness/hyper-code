/**
 * Applies one edit to the current person's global menu (⌘/) layout and saves it as their own (nav.layout,
 * scope user; the instance layout without a signed-in person).
 *
 * Starts from what the person sees now (nav.tabs), so the first edit copies the instance layout into the
 * person's own. Ops: `add` a widget to a tab, `remove` / `move` (dir -1 or 1) / `size` a placement, `config`
 * a placement's settings, `addTab` with a title, `renameTab`, `moveTab`, `removeTab` (a built-in tab is
 * hidden instead), `reset` back to the instance layout.
 * @param opts.op What to change.
 * @param opts.tab Tab id the op works on; for addTab the new tab gets an id derived from the title.
 * @param opts.id Placement id (remove, move, size, config).
 * @param opts.widget Widget id to add (add).
 * @param opts.size New size (size), or the size for add.
 * @param opts.dir Direction for move / moveTab: -1 earlier, 1 later.
 * @param opts.title Tab title (addTab, renameTab).
 * @param opts.config Settings merged into the placement's config (config).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** What to change. */
        op: "add" | "remove" | "move" | "size" | "config" | "addTab" | "renameTab" | "moveTab" | "removeTab" | "reset";
        /** Tab id the op works on; for addTab the new tab gets an id derived from the title. */
        tab?: string;
        /** Placement id (remove, move, size, config). */
        id?: string;
        /** Widget id to add (add). */
        widget?: string;
        /** New size (size), or the size for add. */
        size?: types.nav.Size;
        /** Direction for move / moveTab: -1 earlier, 1 later. */
        dir?: -1 | 1;
        /** Tab title (addTab, renameTab). */
        title?: string;
        /** Settings merged into the placement's config (config). */
        config?: Record<string, unknown>;
    },
): Promise<{ ok: boolean; tab?: string; error?: string }> {
    if (opts.op === "reset") {
        await ctx.fns.nav.saveLayout({ reset: true });
        return { ok: true };
    }
    const { layout } = await ctx.fns.nav.effectiveLayout({});
    const { tabs } = await ctx.fns.nav.tabs({});
    const list: Array<{ id: string } & Partial<types.nav.Tab>> = tabs.map(t => {
        const { search: _search, ...rest } = t;
        const own = (layout.tabs ?? []).find(x => x.id === t.id);
        return own?.search ? { ...rest, search: own.search } : rest;
    });
    const hidden = new Set(layout.hidden ?? []);
    const widgetsHidden = new Set(layout.widgetsHidden ?? []);
    const swap = <T>(arr: T[], i: number, dir: number) => {
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arr.length) return false;
        [arr[i], arr[j]] = [arr[j]!, arr[i]!];
        return true;
    };
    const tab = list.find(t => t.id === opts.tab);
    const fail = (error: string) => ({ ok: false, error });
    switch (opts.op) {
        case "addTab": {
            const title = String(opts.title ?? "").trim().slice(0, 40);
            if (!title) return fail("title required");
            const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tab";
            let id = base;
            for (let n = 2; list.some(t => t.id === id) || id === "home" || id === "plugins"; n++) id = `${base}-${n}`;
            list.push({ id, title, widgets: [] });
            await ctx.fns.nav.saveLayout({ layout: { tabs: list, hidden: [...hidden], widgetsHidden: [...widgetsHidden], searchHidden: layout.searchHidden } });
            return { ok: true, tab: id };
        }
        case "renameTab": {
            if (!tab) return fail("unknown tab");
            const title = String(opts.title ?? "").trim().slice(0, 40);
            if (!title) return fail("title required");
            tab.title = title;
            break;
        }
        case "moveTab": {
            if (!swap(list, list.findIndex(t => t.id === opts.tab), opts.dir ?? 1)) return fail("cannot move");
            break;
        }
        case "removeTab": {
            if (!tab) return fail("unknown tab");
            if (list.length <= 1) return fail("the last tab stays");
            list.splice(list.indexOf(tab), 1);
            if (tab.id === "home" || tab.id === "plugins") hidden.add(tab.id);
            break;
        }
        default: {
            if (!tab) return fail("unknown tab");
            const widgets = (tab.widgets ??= []);
            const at = widgets.findIndex(w => w.id === opts.id);
            if (opts.op === "add") {
                const def = ((ctx.state as any).nav?.widgets ?? {})[String(opts.widget ?? "")];
                if (!def) return fail("unknown widget");
                let id = def.id;
                for (let n = 2; widgets.some(w => w.id === id); n++) id = `${def.id}-${n}`;
                widgets.push({ id, widget: def.id, ...(opts.size ? { size: opts.size } : {}) });
                widgetsHidden.delete(def.id);
            } else if (at < 0) return fail("unknown placement");
            else if (opts.op === "remove") {
                const [gone] = widgets.splice(at, 1);
                // A plugin widget left on no tab would come back on the plugins tab; remember it was removed.
                if (gone && !list.some(t => (t.widgets ?? []).some(w => w.widget === gone.widget))) widgetsHidden.add(gone.widget);
            }
            else if (opts.op === "move") { if (!swap(widgets, at, opts.dir ?? 1)) return fail("cannot move"); }
            else if (opts.op === "size") widgets[at] = { ...widgets[at]!, size: opts.size };
            else if (opts.op === "config") widgets[at] = { ...widgets[at]!, config: { ...(widgets[at]!.config ?? {}), ...(opts.config ?? {}) } };
        }
    }
    await ctx.fns.nav.saveLayout({ layout: { tabs: list, hidden: [...hidden], widgetsHidden: [...widgetsHidden], searchHidden: layout.searchHidden } });
    return { ok: true, tab: opts.op === "removeTab" ? list[0]?.id : opts.tab };
}
