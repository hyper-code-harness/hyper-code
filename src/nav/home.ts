/**
 * Draws the global menu (⌘/) body while the search box is empty: the tab strip (when there is more than one
 * tab) and the chosen tab's grid of widget tiles, every tile drawn in parallel through nav.drawWidget.
 * A `lazy` widget without a fresh cached copy gets a "loading…" placeholder that loads GET /nav/widget.
 *
 * Grid: 4 columns on wide screens, 2 on medium, 1 on narrow; S = 1×1, M = 2×1, L = 2×2, wide = full row,
 * tall = one column × 3 rows. Tiles keep DOM order = visual order = keyboard order (no dense packing).
 * In edit mode every tile gets move / size / remove controls, the grid ends with an "Add widget" picker over
 * the widget catalogue, and the tab strip gets rename / move / remove / new tab / reset — each a POST
 * /nav/layout form (nav.editLayout), keyboard reachable.
 * @param opts.tab Tab id to show; the first tab when omitted or unknown.
 * @param opts.edit Draw the edit controls. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Tab id to show; the first tab when omitted or unknown. */
        tab?: string;
        /** Draw the edit controls. @default false */
        edit?: boolean;
    },
): Promise<string> {
    const w = ctx.fns.w;
    const { tabs } = await ctx.fns.nav.tabs({});
    const tab = tabs.find(t => t.id === opts.tab) ?? tabs[0];
    if (!tab) return w.empty({ title: "No tabs", icon: "squares-four" });
    const widgets = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, types.nav.Widget & types.nav.Registered>;
    const edit = !!opts.edit;
    type Vals = Record<string, string | number>;
    const clean = (vals: Vals) => Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== undefined)) as Vals;
    // Every layout edit is one POST /nav/layout (nav.editLayout); the answer's HX-Trigger redraws the menu.
    const button = (vals: Vals, icon: string, label: string, disabled = false) =>
        w.iconButton({ icon, label, size: 24, disabled, action: { post: "/nav/layout", vals: clean(vals) } });
    const form = (name: string, vals: Vals, body: string, extra: { trigger?: string; confirm?: string } = {}) =>
        w.form({ form: name, post: "/nav/layout", target: "this", swap: "none", vals: clean(vals), body, ...extra });
    const tiles = await Promise.all(tab.widgets.map(async (placement, index) => {
        const def = widgets[placement.widget];
        // A lazy widget never holds the menu up: a fresh cached copy is drawn now, otherwise a placeholder
        // that htmx replaces with GET /nav/widget once the widget has rendered.
        const drawn = await ctx.fns.nav.drawWidget({ placement, peek: !!def?.lazy && !edit });
        const html = drawn.pending
            ? `<div data-nav-lazy hx-get="/nav/widget?${new URLSearchParams({ tab: tab.id, id: placement.id })}" hx-trigger="load" hx-swap="outerHTML">${w.spinner({ kind: "skeleton", lines: 3 })}</div>`
            : drawn.html;
        const title = String((placement.config as any)?.title ?? def?.title ?? placement.widget);
        const at = { tab: tab.id, id: placement.id };
        const sizes = def?.sizes?.length ? def.sizes : ["M"];
        const controls = edit ? `<span class="w-toolbar-end" data-nav-edit-controls>`
            + button({ ...at, op: "move", dir: -1 }, "arrow-left", `Move ${title} earlier`, index === 0)
            + button({ ...at, op: "move", dir: 1 }, "arrow-right", `Move ${title} later`, index === tab.widgets.length - 1)
            + (sizes.length > 1 ? form("nav-size", { ...at, op: "size" }, w.select({ name: "size", label: `Size of ${title}`, value: placement.size, options: sizes }), { trigger: "change" }) : "")
            + button({ ...at, op: "remove" }, "x", `Remove ${title}`)
            + `</span>` : undefined;
        return w.tile({
            title,
            icon: def?.icon?.replace(/^ph-/, ""),
            meta: def && def.module !== "nav" ? def.module : undefined,
            actions: controls,
            size: placement.size ?? "M",
            editing: edit,
            body: html,
            attrs: { "data-nav-widget": placement.id, "data-widget-type": placement.widget },
        });
    }));
    if (edit) {
        const catalogue = Object.values(widgets).sort((a, b) => a.title.localeCompare(b.title));
        const picker = form("nav-add-widget", { op: "add", tab: tab.id },
            w.select({ name: "widget", label: "Widget to add", width: "fill", options: catalogue.map(d => ({ value: d.id, label: `${d.title}${d.module !== "nav" ? ` · ${d.module}` : ""}` })) })
            + w.button({ label: "Add", icon: "plus", tone: "primary", size: "sm", submit: true }));
        const about = w.keyValue({ items: catalogue.filter(d => d.description).map(d => ({ key: d.title, value: d.description! })) });
        tiles.push(w.tile({ title: "Add widget", icon: "plus", body: picker + about, attrs: { "data-nav-add": true } }));
    }
    const tabIndex = tabs.findIndex(t => t.id === tab.id);
    // Tabs are buttons the menu script reads (data-nav-tab): a click or ⌘1–9 shows that tab.
    const items = tabs.length > 1 || edit ? tabs.map((t, i) => ({
        id: t.id, label: t.title, icon: t.icon?.replace(/^ph-/, ""),
        title: `${t.title}${i < 9 ? ` (⌘${i + 1})` : ""}`,
        action: { action: "nav-tab" }, attrs: { "data-nav-tab": t.id },
    })) : [];
    const tools = edit ? `<span class="w-toolbar-end" data-nav-tab-tools>`
        + form("nav-rename-tab", { op: "renameTab", tab: tab.id }, w.input({ name: "title", value: tab.title, label: "Tab title", width: "short" }) + w.iconButton({ icon: "check", label: "Rename tab", size: 24, submit: true }))
        + button({ op: "moveTab", tab: tab.id, dir: -1 }, "caret-left", "Move tab left", tabIndex === 0)
        + button({ op: "moveTab", tab: tab.id, dir: 1 }, "caret-right", "Move tab right", tabIndex === tabs.length - 1)
        + button({ op: "removeTab", tab: tab.id }, "trash", "Remove tab", tabs.length <= 1)
        + form("nav-add-tab", { op: "addTab" }, w.input({ name: "title", placeholder: "New tab", label: "New tab title", width: "short" }) + w.iconButton({ icon: "plus", label: "Add tab", size: 24, submit: true }))
        + form("nav-reset", { op: "reset" }, w.button({ label: "Reset", tone: "ghost", size: "sm", submit: true, title: "Back to the shared layout" }), { confirm: "Reset the menu to the shared layout?" })
        + `</span>` : "";
    const toggle = w.iconButton({ icon: edit ? "check" : "pencil-simple", label: edit ? "Done editing" : "Edit menu", size: 24, pressed: edit, action: { action: "nav-edit" }, attrs: { "data-nav-edit-toggle": true } });
    const strip = w.tabs({ variant: "underline", active: tab.id, items, end: tools + toggle });
    const grid = tiles.length
        ? w.tiles({ body: tiles.join(""), attrs: { "data-nav-tab-body": tab.id } })
        : `<div data-nav-tab-body="${w.escape({ text: tab.id })}">${w.empty({ title: "No widgets on this tab yet", icon: "squares-four", hint: "Press the pencil to add some." })}</div>`;
    return strip + grid;
}
