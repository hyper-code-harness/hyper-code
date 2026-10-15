/**
 * Draws the global menu (⌘/) body while the search box is empty: the tab strip (when there is more than one
 * tab) and the chosen tab's grid of widget tiles, every tile drawn in parallel through nav.drawWidget.
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
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const { tabs } = await ctx.fns.nav.tabs({});
    const tab = tabs.find(t => t.id === opts.tab) ?? tabs[0];
    if (!tab) return `<div class="px-4 py-5 text-sm text-faint">no tabs</div>`;
    const widgets = ((ctx.state as any).nav?.widgets ?? {}) as Record<string, types.nav.Widget & types.nav.Registered>;
    const edit = !!opts.edit;
    const iconButton = "inline-flex size-6 items-center justify-center rounded text-faint hover:bg-base-200 hover:text-base-content disabled:opacity-30";
    const form = (fields: Record<string, string | number | undefined>, inner: string, extra = "") =>
        `<form hx-post="/nav/layout" hx-swap="none" class="inline-flex items-center"${extra}>${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("")}${inner}</form>`;
    const button = (fields: Record<string, string | number | undefined>, icon: string, label: string, disabled = false) =>
        form(fields, `<button type="submit" class="${iconButton}" title="${esc(label)}" aria-label="${esc(label)}"${disabled ? " disabled" : ""}><i class="ph ${icon}" aria-hidden="true"></i></button>`);
    const span: Record<types.nav.Size, string> = {
        S: "",
        M: "",
        L: "lg:row-span-2",
        wide: "lg:col-span-3",
        tall: "lg:row-span-3",
    };
    const tiles = await Promise.all(tab.widgets.map(async (placement, index) => {
        const def = widgets[placement.widget];
        const { html } = await ctx.fns.nav.drawWidget({ placement });
        const title = String((placement.config as any)?.title ?? def?.title ?? placement.widget);
        const at = { tab: tab.id, id: placement.id };
        const sizes = def?.sizes?.length ? def.sizes : ["M"];
        const controls = edit ? `<div class="ml-auto flex items-center gap-0.5" data-nav-edit-controls>`
            + button({ ...at, op: "move", dir: -1 }, "ph-arrow-left", `Move ${title} earlier`, index === 0)
            + button({ ...at, op: "move", dir: 1 }, "ph-arrow-right", `Move ${title} later`, index === tab.widgets.length - 1)
            + (sizes.length > 1 ? form({ ...at, op: "size" }, `<select name="size" aria-label="Size of ${esc(title)}" class="h-6 rounded border border-ui-border bg-base-100 px-1 text-3xs" onchange="this.form.requestSubmit()">${sizes.map(z => `<option value="${z}"${z === placement.size ? " selected" : ""}>${z}</option>`).join("")}</select>`) : "")
            + button({ ...at, op: "remove" }, "ph-x", `Remove ${title}`)
            + `</div>` : "";
        const module = def && def.module !== "nav" ? `<span class="font-normal normal-case tracking-normal text-faint/70">${esc(def.module)}</span>` : "";
        return `<section data-nav-widget="${esc(placement.id)}" data-widget-type="${esc(placement.widget)}" class="min-w-0 bg-base-100 p-2.5 ${span[placement.size ?? "M"] ?? ""}${edit ? " outline-dashed outline-1 -outline-offset-4 outline-ui-border" : ""}"><h3 class="mb-1 flex items-center gap-2 px-2 text-3xs font-semibold uppercase tracking-wider text-faint">${def?.icon ? `<i class="ph ${esc(def.icon)}" aria-hidden="true"></i>` : ""}<span class="truncate">${esc(title)}</span>${module}${controls}</h3>${html}</section>`;
    }));
    if (edit) {
        const catalogue = Object.values(widgets).sort((a, b) => a.title.localeCompare(b.title));
        tiles.push(`<section data-nav-add class="min-w-0 bg-base-100 p-2.5"><h3 class="mb-2 px-2 text-3xs font-semibold uppercase tracking-wider text-faint">Add widget</h3>${form({ op: "add", tab: tab.id }, `<select name="widget" aria-label="Widget to add" class="h-8 min-w-0 flex-1 rounded border border-ui-border bg-base-100 px-2 text-xs">${catalogue.map(w => `<option value="${esc(w.id)}">${esc(w.title)}${w.module !== "nav" ? ` · ${esc(w.module)}` : ""}</option>`).join("")}</select><button type="submit" class="ml-1 inline-flex h-8 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-content"><i class="ph ph-plus" aria-hidden="true"></i>Add</button>`, ' style="display:flex" class="w-full"')}<p class="mt-2 px-2 text-3xs text-faint">${catalogue.map(w => w.description ? `<b>${esc(w.title)}</b> — ${esc(w.description)}` : "").filter(Boolean).join("<br>")}</p></section>`);
    }
    const tabIndex = tabs.findIndex(t => t.id === tab.id);
    const pills = tabs.map((t, i) => `<button type="button" data-nav-tab="${esc(t.id)}" aria-pressed="${t.id === tab.id}" title="${esc(t.title)}${i < 9 ? ` (⌘${i + 1})` : ""}" class="-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs ${t.id === tab.id ? "border-primary font-medium text-base-content" : "border-transparent text-subtle hover:border-ui-border-strong hover:text-base-content"}">${t.icon ? `<i class="ph ${esc(t.icon)}" aria-hidden="true"></i>` : ""}${esc(t.title)}</button>`).join("");
    const tabTools = edit
        ? `<div class="ml-2 flex shrink-0 items-center gap-0.5 self-center border-l border-ui-border pl-2" data-nav-tab-tools>`
            + form({ op: "renameTab", tab: tab.id }, `<input name="title" value="${esc(tab.title)}" aria-label="Tab title" class="h-6 w-28 rounded border border-ui-border bg-base-100 px-1.5 text-xs"><button type="submit" class="${iconButton}" title="Rename tab" aria-label="Rename tab"><i class="ph ph-check" aria-hidden="true"></i></button>`)
            + button({ op: "moveTab", tab: tab.id, dir: -1 }, "ph-caret-left", "Move tab left", tabIndex === 0)
            + button({ op: "moveTab", tab: tab.id, dir: 1 }, "ph-caret-right", "Move tab right", tabIndex === tabs.length - 1)
            + button({ op: "removeTab", tab: tab.id }, "ph-trash", "Remove tab", tabs.length <= 1)
            + form({ op: "addTab" }, `<input name="title" placeholder="New tab" aria-label="New tab title" class="ml-2 h-6 w-24 rounded border border-ui-border bg-base-100 px-1.5 text-xs"><button type="submit" class="${iconButton}" title="Add tab" aria-label="Add tab"><i class="ph ph-plus" aria-hidden="true"></i></button>`)
            + form({ op: "reset" }, `<button type="submit" class="ml-2 rounded px-1.5 py-0.5 text-3xs text-subtle hover:bg-base-200" title="Back to the shared layout">Reset</button>`, ` hx-confirm="Reset the menu to the shared layout?"`)
            + `</div>`
        : "";
    const editToggle = `<button type="button" data-nav-edit-toggle aria-pressed="${edit}" title="${edit ? "Done editing" : "Edit menu"}" aria-label="${edit ? "Done editing" : "Edit menu"}" class="ml-auto inline-flex shrink-0 items-center gap-1 self-center rounded px-2 py-1 text-xs ${edit ? "bg-primary text-primary-content" : "text-faint hover:bg-base-200 hover:text-base-content"}"><i class="ph ${edit ? "ph-check" : "ph-pencil-simple"}" aria-hidden="true"></i>${edit ? "Done" : ""}</button>`;
    const strip = `<nav class="flex items-end gap-1 overflow-x-auto border-b border-ui-border px-3" aria-label="Menu tabs">${tabs.length > 1 || edit ? pills : ""}${tabTools}${editToggle}</nav>`;
    const grid = tiles.length
        ? `<div class="grid grid-cols-1 gap-px bg-base-200 lg:grid-cols-3" style="grid-template-rows:auto auto 1fr" data-nav-tab-body="${esc(tab.id)}">${tiles.join("")}</div>`
        : `<div class="px-4 py-5 text-sm text-faint" data-nav-tab-body="${esc(tab.id)}">No widgets on this tab yet.</div>`;
    return strip + grid;
}
