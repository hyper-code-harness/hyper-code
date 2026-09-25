/**
 * Renders a standard record page: back link, title with id, status, actions, body and side panels
 *
 * Use as the whole `main` of a single-record route (task, document, contact) so
 * detail pages share one structure. Side panels are titled sections in a right
 * column that stacks under the body on narrow screens.
 * @param opts.page Page marker naming the record type, such as `task`.
 * @param opts.back Link back to the collection.
 * @param opts.title Record title.
 * @param opts.id Short record identifier shown after the title.
 * @param opts.status Trusted status HTML, usually `procs.ui.badge`.
 * @param opts.meta Plain-text metadata parts shown next to the status, joined with " · ".
 * @param opts.actions Trusted HTML for record actions on the right of the heading.
 * @param opts.main Trusted HTML of the main body.
 * @param opts.aside Titled side panels with trusted HTML bodies.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Page marker naming the record type, such as `task`. */
    page: string;
    /** Link back to the collection. */
    back?: { href: string; label: string };
    /** Record title. */
    title: string;
    /** Short record identifier shown after the title. */
    id?: string;
    /** Trusted status HTML, usually `procs.ui.badge`. */
    status?: string;
    /** Plain-text metadata parts shown next to the status, joined with " · ". */
    meta?: string[];
    /** Trusted HTML for record actions on the right of the heading. */
    actions?: string;
    /** Trusted HTML of the main body. */
    main: string;
    /** Titled side panels with trusted HTML bodies. */
    aside?: Array<{ title: string; body: string }>;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const ui = ctx.fns.procs.ui;
    const back = opts.back
        ? `<a href="${esc(opts.back.href)}" hx-get="${esc(opts.back.href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true" class="ui-focusable mb-4 inline-flex items-center gap-1 text-sm text-subtle hover:text-base-content" ${ui.attr({ action: "back" })}><i class="ph ph-arrow-left" aria-hidden="true"></i>${esc(opts.back.label)}</a>`
        : "";
    const aside = opts.aside?.length
        ? `<aside class="space-y-5 text-sm">${opts.aside.map(p => `<section ${ui.attr({ section: p.title.toLowerCase().replace(/\W+/g, "-") })}><h2 class="mb-2 border-b border-ui-border pb-2 text-xs font-semibold uppercase tracking-label text-subtle">${esc(p.title)}</h2>${p.body}</section>`).join("")}</aside>`
        : "";
    return `<div class="mx-auto w-full max-w-5xl px-5 py-7" ${ui.attr({ page: opts.page, id: opts.id })}>
  ${back}
  <header class="flex flex-wrap items-start justify-between gap-4 border-b border-ui-border pb-5">
    <div class="min-w-0">
      <h1 class="break-words text-2xl font-semibold tracking-tight">${esc(opts.title)}${opts.id ? ` <span class="font-normal text-faint">#${esc(opts.id)}</span>` : ""}</h1>
      ${opts.status || opts.meta?.length ? `<div class="mt-2 flex flex-wrap items-center gap-2 text-sm text-subtle">${opts.status ?? ""}${opts.meta?.length ? `<span>${opts.meta.map(esc).join(" · ")}</span>` : ""}</div>` : ""}
    </div>
    ${opts.actions ? `<div class="flex shrink-0 items-center gap-2">${opts.actions}</div>` : ""}
  </header>
  <div class="mt-6 grid gap-8 ${aside ? "lg:grid-cols-[minmax(0,1fr)_16rem]" : ""}"><div class="min-w-0">${opts.main}</div>${aside}</div>
</div>`;
}
