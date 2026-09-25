// A white card with a titled strip on top — the workspace's one way of putting
// a list, a table or a rendered thing on the page. The strip says what is in it
// and how much; `right` is where a box-wide action goes.
//
// White on the page's grey, rather than the other way round: a box used to be
// transparent with a grey strip, which read as a card only while the page behind
// it stayed white. Now the page is the quiet surface and every box is raised off
// it, which is what makes a screen look composed instead of dumped.
//
// `body` is html, already rendered: rows through ui.row, a table, a form.
// `head` replaces the title with html when the strip itself is a control — a row
// of tabs over two readings of the same file, say — and then `title` is unused.
/**
 * Perform box for the ui subsystem.
 * @param opts.title The display title.
 * @param opts.head The head value used by the operation.
 * @param opts.right The right value used by the operation.
 * @param opts.body The HTTP body.
 * @param opts.empty The empty value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {title: string; head?: string; right?: string; body: string; empty?: string; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    return `<div class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xs ${opts.class ?? ""}">
  <div class="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3 text-xs text-subtle">
    ${opts.head ?? `<span>${esc(opts.title)}</span>`}${opts.right ?? ""}
  </div>
  ${opts.body || `<div class="border-t border-base-300 px-4 py-3 text-xs text-subtle">${esc(opts.empty ?? "nothing here")}</div>`}
</div>`;
}
