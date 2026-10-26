/**
 * Renders the Dock's side panel: the person's global-menu widgets, by default Recent by project.
 *
 * Draws the sidebar that opens beside the thin Dock in its menu mode (html[data-dock-mode=menu]): a w.pane with a header (Hyper, close; Done while editing), then each widget from dock.panelWidgets drawn exactly as in the global menu (nav.drawWidget, same rows, keys and pins). With edit (GET /dock/panel?edit=1), every widget gets move/remove controls and a catalogue to add more, plus Reset. Served by GET/POST /dock/panel and refreshed live on the agents topic.
 * @param opts.edit Draw the edit controls. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Draw the edit controls. @default false */
        edit?: boolean;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
        const all = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, types.nav.Widget & types.nav.Registered>;
        const edit = !!opts.edit;
        const { widgets, source } = await ctx.fns.dock.panelWidgets({});
        const w = ctx.fns.w;
        const post = (vals: Record<string, string | number>, body: string, confirm?: string) =>
            w.form({ form: "dock-panel", post: "/dock/panel", target: "#dock-panel", vals, body, confirm });
        const tool = (vals: Record<string, string | number>, icon: string, label: string, disabled = false) =>
            post(vals, w.iconButton({ icon, label, submit: true, disabled }));
        const tiles = await Promise.all(widgets.map(async (placement, i) => {
            const def = all[placement.widget];
            const drawn = await ctx.fns.nav.drawWidget({ placement, peek: !!def?.lazy && !edit });
            const body = drawn.pending ? w.spinner({ kind: "skeleton", lines: 3 }) : drawn.html;
            const title = String((placement.config as any)?.title ?? def?.title ?? placement.widget);
            const actions = edit
                ? tool({ op: "move", id: placement.id, dir: -1 }, "caret-up", "Move up", i === 0)
                + tool({ op: "move", id: placement.id, dir: 1 }, "caret-down", "Move down", i === widgets.length - 1)
                + tool({ op: "remove", id: placement.id }, "x", "Remove " + title)
                : undefined;
            // The default Recent widget needs no title: the panel itself is the list.
            const titled = edit || widgets.length > 1 || placement.widget !== "recent";
            return w.listSection({ title: titled ? title : undefined, actions, rows: body, attrs: { "data-dock-panel-widget": placement.id } });
        }));
        if (edit) {
            const catalogue = Object.values(all).sort((a, b) => a.title.localeCompare(b.title));
            const add = post({ op: "add" }, w.select({ name: "widget", label: "Widget to add", width: "fill", options: catalogue.map(c => ({ value: c.id, label: c.title + (c.module !== "nav" ? ` · ${c.module}` : "") })) })
                + w.button({ label: "Add", icon: "plus", tone: "primary", size: "sm", submit: true }));
            const reset = source === "user" ? post({ op: "reset" }, w.button({ label: "Reset to default", tone: "ghost", size: "sm", submit: true }), "Reset the panel to Recent by project?") : "";
            tiles.push(w.listSection({ title: "Add a widget", rows: add + reset }));
        }
        const actions = (edit ? w.iconButton({ icon: "check", label: "Done", pressed: true, action: { get: "/dock/panel", target: "#dock-panel" } }) : "")
            + w.iconButton({ icon: "sidebar-simple", label: "Close — ⌘B", attrs: { "data-dock-mode-set": "bar" } });
        const list = tiles.length ? w.list({ body: tiles.join(""), label: "Recent chats" }) : w.empty({ title: "No widgets" });
        return `<div data-dock-panel-edit="${edit}">${w.pane({ surface: "chrome", header: w.paneHeader({ title: "Hyper", actions }), body: list })}</div>`;
}
