/**
 * Draws a dashboard grid of w.tile panels separated by hairlines: one column on narrow screens, three on wide
 * ones, where a tile's size spans rows or the full width. DOM order is visual order is keyboard order.
 * Use it for a board of independent widgets (the global menu tab, a home page); a list of records wants w.list.
 * @param opts.body Trusted HTML of the tiles (w.tile).
 * @param opts.attrs Behaviour hooks (w.hooks) on the grid, e.g. data-* the page script reads.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the tiles (w.tile). */
    body: string;
    /** Behaviour hooks (w.hooks) on the grid, e.g. data-* the page script reads. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    return `<div class="w-tiles"${ctx.fns.w.hooks({ attrs: opts.attrs })}>${opts.body}</div>`;
}
