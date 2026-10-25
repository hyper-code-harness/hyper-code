/**
 * Draws a vertical 40px bar: a header cell on the 32px header line, entries below, and entries pinned to the
 * bottom — the left Dock, the folded canvas.
 * @param opts.head Trusted HTML of the header cell (usually one railItem).
 * @param opts.items Trusted HTML of the entries (railItems).
 * @param opts.foot Trusted HTML of the entries at the bottom.
 * @param opts.label Accessible name of the bar.
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
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    return `<nav class="w-rail" aria-label="${esc(opts.label ?? "Bar")}"><div class="w-rail-head">${opts.head ?? ""}</div><div class="w-rail-items">${opts.items ?? ""}</div><div class="w-rail-foot">${opts.foot ?? ""}</div></nav>`;
}
