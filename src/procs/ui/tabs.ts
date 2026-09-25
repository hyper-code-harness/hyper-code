/**
 * Renders underline navigation tabs with optional icons and counts
 *
 * Use for switching views of one list (Open / Closed, All / Mine) in a panel
 * header. Each tab is a link that htmx-swaps `#main` and pushes the URL.
 * @param opts.items Tabs in display order.
 * @param opts.current Value of the active tab.
 * @param opts.class Extra CSS classes for the tab strip.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Tabs in display order. */
    items: Array<{ value: string; label: string; href: string; icon?: string; count?: number }>;
    /** Value of the active tab. */
    current?: string;
    /** Extra CSS classes for the tab strip. */
    class?: string;
}): string {
    const esc = (s: unknown) => ctx.fns.procs.ui.escape({ text: s });
    const tab = (it: { value: string; label: string; href: string; icon?: string; count?: number }) => {
        const on = it.value === opts.current;
        return `<a class="ui-tabs__item ui-focusable" href="${esc(it.href)}" hx-get="${esc(it.href)}" hx-target="#main" hx-swap="innerHTML" hx-push-url="true" aria-current="${on ? "page" : "false"}" ${ctx.fns.procs.ui.attr({ entity: "tab", id: it.value, status: on ? "active" : "" })}>${it.icon ? `<i class="ph ${esc(it.icon)}" aria-hidden="true"></i>` : ""}${it.count != null ? `<span>${esc(it.count)}</span> ` : ""}${esc(it.label)}</a>`;
    };
    return `<nav class="ui-tabs text-sm ${opts.class ?? ""}" aria-label="Views">${opts.items.map(tab).join("")}</nav>`;
}
