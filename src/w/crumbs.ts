/**
 * Draws a breadcrumb trail: the parents as links (htmx navigation into #main with history), the current page last
 * and plain. Use it at the top of a detail page to say where it sits.
 * @param opts.items Trail from the root; every item but the last should carry href.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trail from the root; every item but the last should carry href. */
    items: Array<{ label: string; href?: string }>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const last = opts.items.length - 1;
    const sep = `<span class="w-crumb-sep" aria-hidden="true">/</span>`;
    const parts = opts.items.map((c, i) => {
        const href = c.href && i < last ? ctx.fns.w.safeUrl({ url: c.href }) : null;
        return href
            ? `<a href="${esc(href)}" hx-get="${esc(href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true">${esc(c.label)}</a>`
            : `<span${i === last ? ' aria-current="page"' : ""}>${esc(c.label)}</span>`;
    });
    return `<nav class="w-crumbs" aria-label="Breadcrumb" ${ctx.fns.w.marks({ role: "breadcrumb" })}>${parts.join(sep)}</nav>`;
}
