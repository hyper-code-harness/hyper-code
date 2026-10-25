/**
 * Draws a card: an optional title row with an icon and actions, a body and a footer, in a tone for its border.
 * @param opts.title Title text.
 * @param opts.icon Phosphor icon before the title.
 * @param opts.body Trusted body HTML.
 * @param opts.actions Trusted HTML on the title row.
 * @param opts.footer Trusted footer HTML.
 * @param opts.flush The body has no padding: records (w.record) and lists run edge to edge.
 * @param opts.tone Border meaning (danger for a danger zone).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Title text. */
    title?: string;
    /** Phosphor icon before the title. */
    icon?: string;
    /** Trusted body HTML. */
    body: string;
    /** Trusted HTML on the title row. */
    actions?: string;
    /** Trusted footer HTML. */
    footer?: string;
    /** The body has no padding: records (w.record) and lists run edge to edge. */
    flush?: boolean;
    /** Border meaning (danger for a danger zone). */
    tone?: types.w.Tone;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const head = opts.title ? `<div class="w-card-head">${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 12 }) : ""}<span>${esc(opts.title)}</span>${opts.actions ? `<span class="w-card-actions">${opts.actions}</span>` : ""}</div>` : "";
    return `<section class="w-card"${opts.tone ? ` data-tone="${opts.tone}"` : ""}>${head}<div class="w-card-body"${opts.flush ? " data-flush" : ""}>${opts.body}</div>${opts.footer ? `<div class="w-card-foot">${opts.footer}</div>` : ""}</section>`;
}
