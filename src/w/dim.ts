/**
 * Dims a block that is kept for the record but no longer counts — a message taken out of the model's context,
 * a repaired attempt — with an optional small badge on its top edge saying why.
 * @param opts.body Trusted HTML of the dimmed block (already rendered widgets).
 * @param opts.label Badge text on the top edge, e.g. "outside context".
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the dimmed block (already rendered widgets). */
    body: string;
    /** Badge text on the top edge, e.g. "outside context". */
    label?: string;
}): string {
    const badge = opts.label ? `<span class="w-dim-badge">${ctx.fns.w.badge({ text: opts.label })}</span>` : "";
    return `<div class="w-dim">${badge}${opts.body}</div>`;
}
