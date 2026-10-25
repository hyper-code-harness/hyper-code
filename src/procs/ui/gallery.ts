/**
 * Shows every shared UI component with sample props on one page.
 *
 * The component catalogue of Hyper: each procs.ui renderer drawn with typical props, grouped into actions, status, forms and layout/data. Open it on the canvas (/rpc/procs.ui.gallery) to see what exists before writing markup by hand, and to check a theme or a component change everywhere at once. A component that throws shows its error in its cell instead of breaking the page.
 * @view
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<string> {
    const ui: any = (ctx.fns as any).procs.ui;
        const esc = (v: unknown) => ui.escape({ text: String(v ?? "") });
        const safe = async (name: string, f: () => any): Promise<string> => {
            try { return String(await f()); } catch (e: any) { return `<span class="text-error text-xs">${esc(name)}: ${esc(e?.message ?? e)}</span>`; }
        };
        // One sample per component — the props a reader would try first. Grouped the way people look for things.
        const groups: Array<[string, Array<[string, () => any]>]> = [
            ["Actions", [
                ["button", () => [ui.button({ label: "Default" }), ui.button({ label: "Primary", tone: "primary" }), ui.button({ label: "Danger", tone: "danger" }), ui.button({ label: "Ghost", tone: "ghost" }), ui.button({ label: "Small", size: "sm" }), ui.button({ label: "Disabled", disabled: true })].join(" ")],
                ["dialogButton", () => ui.dialogButton({ dialog: "gallery-dialog", label: "Open dialog", icon: "ph-plus" }) + ui.dialog({ id: "gallery-dialog", title: "Dialog", body: "<p class=\"text-sm\">A dialog body.</p>" })],
                ["menu", () => ui.menu({ label: "Actions", icon: "ph-dots-three", items: [{ label: "Rename", icon: "ph-pencil-simple" }, { label: "Duplicate", icon: "ph-copy" }, { label: "Delete", icon: "ph-trash", danger: true }] })],
                ["toggle", () => ui.toggle({ action: "gallery-toggle", label: "Enabled", on: true })],
                ["segmented", () => ui.segmented({ items: [{ label: "Chat", value: "chat" }, { label: "Chat + canvas", value: "both" }, { label: "Canvas", value: "canvas" }], value: "both" })],
            ]],
            ["Status", [
                ["badge", () => ["neutral", "info", "success", "warning", "danger"].map(t => ui.badge({ text: t, tone: t })).join(" ")],
                ["statusDot", () => ["idle", "running", "error", "done"].map(s => ui.statusDot({ status: s, label: s })).join(" ")],
                ["tags", () => ui.tags({ items: [{ label: "ui" }, { label: "canvas", tone: "info" }, { label: "urgent", tone: "danger" }] })],
                ["progress", () => ui.progress({ value: 62, label: "62%" })],
                ["sparkline", () => ui.sparkline({ values: [3, 5, 4, 8, 6, 9, 12, 10, 14] })],
                ["alert", () => ui.alert({ tone: "warning", title: "Heads up", text: "Something needs your attention." })],
                ["notice", () => ui.notice({ text: "Saved.", tone: "success" })],
            ]],
            ["Forms", [
                ["field", () => ui.field({ name: "g-name", placeholder: "Name", ariaLabel: "Name" })],
                ["inputGroup", () => ui.inputGroup({ name: "g-url", prefix: "https://", suffix: ".dev", placeholder: "site", ariaLabel: "Site" })],
                ["select", () => ui.select({ name: "g-sel", value: "b", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] })],
                ["textarea", () => ui.textarea({ name: "g-text", placeholder: "Write…", rows: 2 })],
                ["checkboxGroup", () => ui.checkboxGroup({ name: "g-cb", value: ["a"], options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] })],
                ["radioGroup", () => ui.radioGroup({ name: "g-rb", value: "a", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] })],
                ["slider", () => ui.slider({ name: "g-sl", value: 40 })],
                ["range", () => ui.range({ name: "g-rg", value: 30, ariaLabel: "Range" })],
            ]],
            ["Layout & data", [
                ["heading", () => ui.heading({ title: "Page title", meta: "12 items", actions: ui.button({ label: "New", tone: "primary", size: "sm" }) })],
                ["toolbar", () => ui.toolbar({ left: ui.button({ label: "Back", tone: "ghost", size: "sm" }), right: ui.button({ label: "Save", tone: "primary", size: "sm" }) })],
                ["card", () => ui.card({ title: "Card", body: "<p class=\"text-sm\">Card body.</p>", footer: "<span class=\"text-xs text-faint\">footer</span>" })],
                ["box", () => ui.box({ title: "Box", body: "<p class=\"text-sm p-3\">Box body.</p>" })],
                ["stats", () => ui.stats({ items: [{ label: "Agents", value: 42 }, { label: "Running", value: 3, tone: "info" }, { label: "Errors", value: 0, tone: "success" }] })],
                ["descriptionList", () => ui.descriptionList({ items: [{ term: "Model", detail: "opus-5.5" }, { term: "Project", detail: "hyper-design" }], cols: 2 })],
                ["table", () => ui.table({ columns: [{ key: "id", label: "Id" }, { key: "title", label: "Title" }], rows: [{ id: "da", title: "UI layouts" }, { id: "at", title: "Оливия" }] })],
                ["timeline", () => ui.timeline({ items: [{ title: "Created", meta: "10:02" }, { title: "Pushed", meta: "13:48", tone: "success" }] })],
                ["steps", () => ui.steps({ steps: [{ label: "Plan" }, { label: "Build" }, { label: "Ship" }], current: 1 })],
                ["tabs", () => ui.tabs({ items: [{ value: "a", label: "Overview", href: "#" }, { value: "b", label: "Settings", href: "#", count: 3 }], current: "a" })],
                ["breadcrumb", () => ui.breadcrumb({ items: [{ label: "Projects", href: "#" }, { label: "hyper-design" }] })],
                ["pagination", () => ui.pagination({ page: 2, pages: 5, href: (p: number) => "#p" + p })],
                ["empty", () => ui.empty({ icon: "ph-tray", title: "Nothing here", text: "Items will appear here." })],
                ["skeleton", () => ui.skeleton({ lines: 3 })],
                ["avatar", () => ["sm", "md", "lg"].map(s => ui.avatar({ name: "Nikolai Ryzhikov", size: s })).join(" ")],
                ["tooltip", () => ui.tooltip({ label: "A tooltip", children: ui.button({ label: "Hover me", size: "sm" }) })],
                ["code", () => ui.code({ code: "const x = 1;", lang: "ts" })],
            ]],
        ];
        const sections = await Promise.all(groups.map(async ([title, items]) => {
            const cells = await Promise.all(items.map(async ([name, f]) => `<div class="ui-gallery-cell" data-ui-sample="${esc(name)}"><div class="ui-gallery-name"><code>procs.ui.${esc(name)}</code></div><div class="ui-gallery-sample">${await safe(name, f)}</div></div>`));
            return `<section class="ui-gallery-group"><h2>${esc(title)}</h2><div class="ui-gallery-grid">${cells.join("")}</div></section>`;
        }));
        const style = `<style>
    .ui-gallery{max-width:72rem;margin:0 auto;padding:1.25rem 1.5rem 3rem;font-size:13px}
    .ui-gallery h1{font-size:20px;font-weight:600;margin:0 0 .25rem}
    .ui-gallery>p{color:color-mix(in oklab,var(--color-base-content) 55%,transparent);margin:0 0 1rem}
    .ui-gallery-group h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:color-mix(in oklab,var(--color-base-content) 50%,transparent);margin:1.5rem 0 .5rem}
    .ui-gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(20rem,1fr));gap:1px;background:var(--color-ui-border);border:1px solid var(--color-ui-border);border-radius:.5rem;overflow:visible}
    .ui-gallery-cell{background:var(--color-base-100);padding:.75rem .875rem;min-width:0}
    .ui-gallery-name{margin-bottom:.5rem}.ui-gallery-name code{font-size:11px;color:color-mix(in oklab,var(--color-base-content) 55%,transparent)}
    .ui-gallery-sample{display:flex;flex-wrap:wrap;align-items:center;gap:.375rem;min-width:0}
    .ui-gallery-sample>*{max-width:100%}
    </style>`;
        return `${style}<div class="ui-gallery"><h1>UI components</h1><p>Every shared component, drawn by its own renderer with sample props. Use these instead of hand-written markup; a theme repaints all of them at once.</p>${sections.join("")}</div>`;
}
