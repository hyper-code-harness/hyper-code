/**
 * Renders a standard list page: header, actions, tabs, filters, rows, empty state and pagination
 *
 * Use as the whole `main` of a collection route so every module's list looks and
 * behaves the same. Pass rows already rendered with `procs.ui.listItem`, `row` or
 * `table`; when `rows` is empty the `empty` state is shown inside the panel.
 * Dialogs and other overlays go in `extra`.
 * @param opts.page Page marker naming what is on screen, such as `tasks`.
 * @param opts.title Page heading.
 * @param opts.lead One-sentence description under the heading.
 * @param opts.actions Trusted HTML for primary actions on the right of the heading.
 * @param opts.tabs Trusted HTML of `procs.ui.tabs` shown in the panel header.
 * @param opts.filters Trusted HTML of `procs.ui.filterBar` shown in the panel header.
 * @param opts.rows Trusted rendered rows; empty string shows the empty state.
 * @param opts.empty Empty-state content.
 * @param opts.footer Trusted HTML under the panel, typically `procs.ui.pagination`.
 * @param opts.extra Trusted HTML appended after the page, such as dialogs.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Page marker naming what is on screen, such as `tasks`. */
    page: string;
    /** Page heading. */
    title: string;
    /** One-sentence description under the heading. */
    lead?: string;
    /** Trusted HTML for primary actions on the right of the heading. */
    actions?: string;
    /** Trusted HTML of `procs.ui.tabs` shown in the panel header. */
    tabs?: string;
    /** Trusted HTML of `procs.ui.filterBar` shown in the panel header. */
    filters?: string;
    /** Trusted rendered rows; empty string shows the empty state. */
    rows: string;
    /** Empty-state content. */
    empty?: { title: string; text?: string; icon?: string; action?: string };
    /** Trusted HTML under the panel, typically `procs.ui.pagination`. */
    footer?: string;
    /** Trusted HTML appended after the page, such as dialogs. */
    extra?: string;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const ui = ctx.fns.procs.ui;
    const head = opts.tabs || opts.filters
        ? `<div class="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border bg-base-200 px-4 py-2.5">${opts.tabs ?? "<span></span>"}${opts.filters ?? ""}</div>`
        : "";
    const empty = opts.empty ?? { title: "Nothing here yet" };
    const body = opts.rows || `<div class="p-4">${ui.empty({ title: empty.title, text: empty.text, icon: empty.icon, action: empty.action })}</div>`;
    return `<div class="mx-auto w-full max-w-5xl px-5 py-7" ${ui.attr({ page: opts.page })}>
  <header class="mb-5 flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0"><h1 class="text-2xl font-semibold tracking-tight">${esc(opts.title)}</h1>${opts.lead ? `<p class="mt-1 text-sm text-subtle">${esc(opts.lead)}</p>` : ""}</div>
    ${opts.actions ? `<div class="flex shrink-0 items-center gap-2">${opts.actions}</div>` : ""}
  </header>
  <section class="overflow-hidden rounded-xl border border-ui-border bg-base-100 shadow-sm" ${ui.attr({ section: "list" })}>${head}${body}</section>
  ${opts.footer ? `<div class="mt-4 flex justify-center">${opts.footer}</div>` : ""}
  ${opts.extra ?? ""}
</div>`;
}
