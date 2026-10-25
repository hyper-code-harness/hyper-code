/**
 * Draws a thin rule, or a quiet labelled line in a list or a chat ("stopped by user", "compacted 600k → 2k").
 * @param opts.label Text in the middle; omit for a plain rule.
 * @param opts.icon Phosphor icon before the label.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Text in the middle; omit for a plain rule. */
    label?: string;
    /** Phosphor icon before the label. */
    icon?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    if (!opts.label) return '<hr class="w-divider">';
    return `<div class="w-divider" role="separator"><span>${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 12 }) : ""}${esc(opts.label)}</span></div>`;
}
