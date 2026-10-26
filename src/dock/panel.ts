/**
 * Renders the Dock's side panel: the person's global-menu widgets, by default Recent by project.
 *
 * Draws the sidebar that opens beside the thin Dock in its menu mode (html[data-dock-mode=menu]): a w.pane with a header (Hyper, close), then each widget from dock.panelWidgets drawn exactly as in the global menu (nav.drawWidget, same rows, keys and pins). Served by GET /dock/panel and refreshed live on the agents topic.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: Record<string, never>,
): Promise<string> {
    const all = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, types.nav.Widget & types.nav.Registered>;
    const { widgets } = await ctx.fns.dock.panelWidgets({});
    const w = ctx.fns.w;
    const tiles = await Promise.all(widgets.map(async placement => {
        const def = all[placement.widget];
        const drawn = await ctx.fns.nav.drawWidget({ placement, peek: !!def?.lazy });
        const body = drawn.pending ? w.spinner({ kind: "skeleton", lines: 3 }) : drawn.html;
        const title = String((placement.config as any)?.title ?? def?.title ?? placement.widget);
        // The default Recent widget needs no title: the panel itself is the list.
        const titled = widgets.length > 1 || placement.widget !== "recent";
        return w.listSection({ title: titled ? title : undefined, rows: body, attrs: { "data-dock-panel-widget": placement.id } });
    }));
    const actions = w.iconButton({ icon: "sidebar-simple", label: "Close — ⌘B", attrs: { "data-dock-mode-set": "bar" } });
    const list = tiles.length ? w.list({ body: tiles.join(""), label: "Recent chats" }) : w.empty({ title: "No widgets" });
    return `<div class="dock-panel-body">${w.pane({ surface: "chrome", header: w.paneHeader({ title: "Hyper", actions }), body: list })}</div>`;
}
