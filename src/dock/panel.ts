/**
 * Renders the Dock's side panel: the person's global-menu widgets, by default Recent by project.
 *
 * Draws the sidebar that opens beside the thin Dock in its menu mode (html[data-dock-mode=menu]): a header (Hyper, search, edit, close), then each widget from dock.panelWidgets drawn exactly as in the global menu (nav.drawWidget, same rows, keys and pins). With edit, every widget gets move/remove controls and a catalogue to add more, plus Reset. Served by GET/POST /dock/panel and refreshed live on the agents topic.
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
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
        const all = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, types.nav.Widget & types.nav.Registered>;
        const edit = !!opts.edit;
        const { widgets, source } = await ctx.fns.dock.panelWidgets({});
        const small = "inline-flex size-6 items-center justify-center rounded text-faint hover:bg-base-200 hover:text-base-content disabled:opacity-30";
        const form = (fields: Record<string, string | number>, inner: string, extra = "") =>
            `<form hx-post="/dock/panel" hx-target="#dock-panel" hx-swap="innerHTML" class="inline-flex items-center"${extra}>${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("")}${inner}</form>`;
        const button = (fields: Record<string, string | number>, icon: string, label: string, disabled = false) =>
            form(fields, `<button type="submit" class="${small}" title="${esc(label)}" aria-label="${esc(label)}"${disabled ? " disabled" : ""}><i class="ph ${icon}" aria-hidden="true"></i></button>`);
        const tiles = await Promise.all(widgets.map(async (placement, i) => {
            const def = all[placement.widget];
            const drawn = await ctx.fns.nav.drawWidget({ placement, peek: !!def?.lazy && !edit });
            const body = drawn.pending ? '<div class="px-2 py-2 text-xs text-faint">loading…</div>' : drawn.html;
            const title = String((placement.config as any)?.title ?? def?.title ?? placement.widget);
            const controls = edit ? `<span class="ml-auto flex items-center gap-0.5 normal-case tracking-normal">`
                + button({ op: "move", id: placement.id, dir: -1 }, "ph-caret-up", "Move up", i === 0)
                + button({ op: "move", id: placement.id, dir: 1 }, "ph-caret-down", "Move down", i === widgets.length - 1)
                + button({ op: "remove", id: placement.id }, "ph-x", "Remove " + title) + "</span>" : "";
            // The default Recent widget needs no title: the panel itself is the list.
            const head = edit || widgets.length > 1 || placement.widget !== "recent"
                ? `<h3 class="mb-1 flex h-6 items-center gap-2 px-1.5 text-3xs font-semibold uppercase tracking-wider text-faint">${def?.icon ? `<i class="ph ${esc(def.icon)}" aria-hidden="true"></i>` : ""}<span class="truncate">${esc(title)}</span>${controls}</h3>` : "";
            return `<section data-dock-panel-widget="${esc(placement.id)}" class="min-w-0 py-1.5${edit ? " rounded-lg outline-dashed outline-1 -outline-offset-2 outline-ui-border px-1" : ""}">${head}${body}</section>`;
        }));
        if (edit) {
            const catalogue = Object.values(all).sort((a, b) => a.title.localeCompare(b.title));
            tiles.push(`<section class="py-2">${form({ op: "add" }, `<select name="widget" aria-label="Widget to add" class="h-7 min-w-0 flex-1 rounded border border-ui-border bg-base-100 px-1.5 text-xs">${catalogue.map(w => `<option value="${esc(w.id)}">${esc(w.title)}${w.module !== "nav" ? ` · ${esc(w.module)}` : ""}</option>`).join("")}</select><button type="submit" class="ml-1 inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-content"><i class="ph ph-plus" aria-hidden="true"></i>Add</button>`, ' style="display:flex"')}`
                + (source === "user" ? form({ op: "reset" }, '<button type="submit" class="mt-2 rounded px-1.5 py-0.5 text-3xs text-subtle hover:bg-base-200">Reset to default</button>', ' hx-confirm="Reset the panel to Recent by project?"') : "")
                + "</section>");
        }
        const icon = (ph: string, title: string, attrs: string) => `<button type="button" class="flex size-7 items-center justify-center rounded-md text-faint hover:bg-base-200 hover:text-base-content${ph === "ph-check" ? " bg-primary text-primary-content hover:bg-primary hover:text-primary-content" : ""}" title="${esc(title)}" aria-label="${esc(title)}" ${attrs}><i class="ph ${ph}" aria-hidden="true"></i></button>`;
        const editToggle = icon(edit ? "ph-check" : "ph-pencil-simple", edit ? "Done" : "Choose widgets", `hx-get="/dock/panel${edit ? "" : "?edit=1"}" hx-target="#dock-panel" hx-swap="innerHTML"`);
        return `<div class="flex h-full min-h-0 flex-col" data-dock-panel-edit="${edit}">
      <div class="flex h-11 shrink-0 items-center gap-0.5 border-b border-ui-border pl-3 pr-1.5"><span class="flex-1 text-sm font-semibold tracking-tight">Hyper</span>${icon("ph-magnifying-glass", "Search — ⌘/", 'onclick="window.__navOpen?.()"')}${editToggle}${icon("ph-sidebar-simple", "Close — ⌘B", 'data-dock-mode-set="bar"')}</div>
      <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 [scrollbar-width:thin]">${tiles.join("") || '<div class="px-2 py-4 text-xs text-faint">No widgets. Press ✎ to add some.</div>'}</div>
    </div>`;
}
