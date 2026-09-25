// The trail to where you are — patients / Anna Ivanova / PHQ-9. Each crumb but
// the last is a link; the last is where you are.
/**
 * Perform breadcrumb for the ui subsystem.
 * @param opts.items The items value used by the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {items: Array<{ label: string; href?: string }> }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const last = opts.items.length - 1;
    // the shared component layer's `breadcrumbs` draws the separators itself, so the caret icon goes.
    return `<nav class="breadcrumbs text-subtle py-0 text-xs" ${ctx.fns.procs.ui.attr({ role: "breadcrumb" })}>
  <ul>${opts.items.map((c, i) => {
        const crumb = c.href && i < last
            ? `<a href="${esc(c.href)}" hx-get="${esc(c.href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true">${esc(c.label)}</a>`
            : `<span class="${i === last ? "text-base-content font-medium" : ""}">${esc(c.label)}</span>`;
        return `<li>${crumb}</li>`;
    }).join("")}</ul>
</nav>`;
}
