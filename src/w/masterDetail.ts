/**
 * Draws two columns in one panel: a narrow master list on the left and the detail of the chosen item on the
 * right, with a hairline between them. Choosing stays with the page script (it shows one detail, hides the rest).
 * Use it inside a tile or a pane for "pick a group, see its items" (projects → their chats); two resizable panes
 * of a page are w.split.
 * @param opts.master Trusted HTML of the master column (w.listRow rows).
 * @param opts.detail Trusted HTML of the detail column (one or several panels, all but one hidden).
 * @param opts.attrs Behaviour hooks (w.hooks) on the whole block, e.g. data-* the script looks for.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the master column (w.listRow rows). */
    master: string;
    /** Trusted HTML of the detail column (one or several panels, all but one hidden). */
    detail: string;
    /** Behaviour hooks (w.hooks) on the whole block, e.g. data-* the script looks for. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    return `<div class="w-master-detail"${ctx.fns.w.hooks({ attrs: opts.attrs })}><div class="w-master-detail-master">${opts.master}</div><div class="w-master-detail-detail">${opts.detail}</div></div>`;
}
