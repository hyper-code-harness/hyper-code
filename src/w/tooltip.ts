/**
 * Wraps content with a tooltip that shows on hover and keyboard focus (CSS only).
 * @param opts.label Tooltip text.
 * @param opts.html Trusted HTML the tooltip belongs to.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Tooltip text. */
    label: string;
    /** Trusted HTML the tooltip belongs to. */
    html: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    return `<span class="w-tooltip" data-tip="${esc(opts.label)}">${opts.html}</span>`;
}
