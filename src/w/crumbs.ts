/**
 * Draws a breadcrumb trail: the parents as links (htmx navigation into #main with history), the current page last
 * and plain. Use it at the top of a detail page to say where it sits.
 * @param opts.items Trail from the root; every item but the last should carry href.
 * @param opts.plain Plain links, without the htmx swap into #main — for a fragment shown elsewhere (a canvas tab follows its own links). @default false
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trail from the root; every item but the last should carry href. */
    items: Array<{ label: string; href?: string }>;
    /** Plain links, without the htmx swap into #main — for a fragment shown elsewhere (a canvas tab follows its own links). @default false */
    plain?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const last = opts.items.length - 1;
    const sep = `<span class="w-crumb-sep" aria-hidden="true">/</span>`;
    const parts = opts.items.map((c, i) => {
        const href = c.href && i < last ? ctx.fns.w.safeUrl({ url: c.href }) : null;
        return href
            ? `<a href="${esc(href)}"${opts.plain ? "" : ` hx-get="${esc(href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true"`}>${esc(c.label)}</a>`
            : `<span${i === last ? ' aria-current="page"' : ""}>${esc(c.label)}</span>`;
    });
    // A root that is itself a slash ("/", "host:/") needs no separator after it: "/ Users", not "/ / Users".
    const joined = parts.map((p, i) => i === 0 ? p : (/\/$/.test(opts.items[i - 1]!.label) ? "" : sep) + p).join("");
    return `<nav class="w-crumbs" aria-label="Breadcrumb" ${ctx.fns.w.marks({ role: "breadcrumb" })}>${joined}</nav>`;
}
