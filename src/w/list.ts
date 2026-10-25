/**
 * Draws a list: rows or sections in one container that keyboard navigation (↑ ↓ ↵) treats as one list.
 * @param opts.body Trusted HTML of rows and sections.
 * @param opts.label Accessible name.
 * @param opts.empty Text shown when there are no rows.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of rows and sections. */
    body: string;
    /** Accessible name. */
    label?: string;
    /** Text shown when there are no rows. */
    empty?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const body = opts.body.trim() || ctx.fns.w.empty({ title: opts.empty ?? "Nothing here" });
    return `<div class="w-list" role="list"${opts.label ? ` aria-label="${esc(opts.label)}"` : ""}>${body}</div>`;
}
