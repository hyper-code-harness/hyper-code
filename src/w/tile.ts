/**
 * Draws one panel of a w.tiles grid: a quiet caption (icon, title, the owning module) with controls on the right,
 * and the panel's content under it. The size decides how much of the grid it takes.
 * Use inside w.tiles only; a standalone framed block is w.card.
 * @param opts.title Caption of the panel.
 * @param opts.body Trusted HTML of the content (rows, a chart, an empty state).
 * @param opts.icon Phosphor icon name before the title, without the ph- prefix.
 * @param opts.meta Quiet text after the title, e.g. the plugin it comes from.
 * @param opts.actions Trusted HTML of controls at the right of the caption (w.iconButton, a w.form).
 * @param opts.size S and M take one cell, L two rows, tall three rows, wide the full row. @default "M"
 * @param opts.editing Show the panel as being arranged (a dashed outline). @default false
 * @param opts.attrs Behaviour hooks (w.hooks) on the panel: data-* the page script reads.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Caption of the panel. */
    title: string;
    /** Trusted HTML of the content (rows, a chart, an empty state). */
    body: string;
    /** Phosphor icon name before the title, without the ph- prefix. */
    icon?: string;
    /** Quiet text after the title, e.g. the plugin it comes from. */
    meta?: string;
    /** Trusted HTML of controls at the right of the caption (w.iconButton, a w.form). */
    actions?: string;
    /** S and M take one cell, L two rows, tall three rows, wide the full row. @default "M" */
    size?: "S" | "M" | "L" | "wide" | "tall";
    /** Show the panel as being arranged (a dashed outline). @default false */
    editing?: boolean;
    /** Behaviour hooks (w.hooks) on the panel: data-* the page script reads. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const head = `<div class="w-tile-head">${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 14 }) : ""}<span class="w-tile-title">${esc(opts.title)}</span>${opts.meta ? `<span class="w-tile-meta">${esc(opts.meta)}</span>` : ""}${opts.actions ? `<span class="w-tile-actions">${opts.actions}</span>` : ""}</div>`;
    return `<section class="w-tile" data-size="${opts.size ?? "M"}"${opts.editing ? " data-editing" : ""}${ctx.fns.w.hooks({ attrs: opts.attrs })}>${head}${opts.body}</section>`;
}
