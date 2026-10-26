/**
 * Draws a vertical 40px bar: a header cell on the 32px header line, entries below, and entries pinned to the
 * bottom — the left Dock, the folded canvas.
 * @param opts.head Trusted HTML of the header cell (usually one railItem).
 * @param opts.items Trusted HTML of the entries (railItems).
 * @param opts.foot Trusted HTML of the entries at the bottom.
 * @param opts.label Accessible name of the bar.
 * @param opts.attrs Behaviour hooks (w.hooks) on the bar itself: id, data-*, aria-*.
 * @param opts.itemsAttrs Behaviour hooks on the entries area (an id or data-* a page script reorders).
 * @param opts.footAttrs Behaviour hooks on the bottom area.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the header cell (usually one railItem). */
    head?: string;
    /** Trusted HTML of the entries (railItems). */
    items?: string;
    /** Trusted HTML of the entries at the bottom. */
    foot?: string;
    /** Accessible name of the bar. */
    label?: string;
    /** Behaviour hooks (w.hooks) on the bar itself: id, data-*, aria-*. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
    /** Behaviour hooks on the entries area (an id or data-* a page script reorders). */
    itemsAttrs?: Record<string, string | number | boolean | null | undefined>;
    /** Behaviour hooks on the bottom area. */
    footAttrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const hooks = (attrs?: Record<string, string | number | boolean | null | undefined>) => ctx.fns.w.hooks({ attrs });
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    return `<nav class="w-rail" aria-label="${esc(opts.label ?? "Bar")}"${hooks(opts.attrs)}><div class="w-rail-head">${opts.head ?? ""}</div><div class="w-rail-items"${hooks(opts.itemsAttrs)}>${opts.items ?? ""}</div><div class="w-rail-foot"${hooks(opts.footAttrs)}>${opts.foot ?? ""}</div></nav>`;
}
