/**
 * Renders a live search-and-filter form that re-renders the current list page
 *
 * Use above a list: typing in the search box (debounced) or changing a select
 * issues an htmx GET to `href` with the form values, swaps `#main` and pushes the
 * URL, so filters are shareable and survive reload. Hidden fields keep other state
 * such as the active tab.
 * @param opts.href List URL that receives the query parameters.
 * @param opts.q Current search text. @default ""
 * @param opts.placeholder Search box placeholder. @default Search…
 * @param opts.selects Select filters rendered after the search box.
 * @param opts.hidden Extra query parameters preserved on every request.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** List URL that receives the query parameters. */
    href: string;
    /** Current search text. @default "" */
    q?: string;
    /** Search box placeholder. @default Search… */
    placeholder?: string;
    /** Select filters rendered after the search box. */
    selects?: Array<{ name: string; value?: string; label: string; options: Array<{ value: string; label: string }> }>;
    /** Extra query parameters preserved on every request. */
    hidden?: Record<string, string>;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const ui = ctx.fns.procs.ui;
    const hidden = Object.entries(opts.hidden ?? {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
    const selects = (opts.selects ?? []).map(s => ui.select({ name: s.name, value: s.value, options: s.options, placeholder: s.label, ariaLabel: s.label, class: "w-auto" })).join("");
    return `<form role="search" class="flex flex-wrap items-center gap-2" action="${esc(opts.href)}" method="GET" hx-get="${esc(opts.href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true" hx-trigger="input changed delay:300ms from:find input[type=search], change from:find select, submit" ${ui.attr({ form: "filters" })}>
  ${hidden}<label class="relative block"><i class="ph ph-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true"></i><input type="search" name="q" value="${esc(opts.q ?? "")}" placeholder="${esc(opts.placeholder ?? "Search…")}" aria-label="${esc(opts.placeholder ?? "Search")}" class="input input-sm w-56 pl-7" ${ui.attr({ field: "q" })}></label>${selects}
</form>`;
}
