/**
 * Draws a section heading inside a page: a title, an optional quiet line under it and actions on the right.
 * Use it above a group of records or a card list on a page (w.page has its own, larger title).
 * @param opts.title Section title.
 * @param opts.lead Trusted HTML before the title (a logo or an icon).
 * @param opts.meta Trusted HTML of one quiet line under the title.
 * @param opts.actions Trusted HTML of the controls on the right (w.button).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Section title. */
    title: string;
    /** Trusted HTML before the title (a logo or an icon). */
    lead?: string;
    /** Trusted HTML of one quiet line under the title. */
    meta?: string;
    /** Trusted HTML of the controls on the right (w.button). */
    actions?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    return `<div class="w-heading"><div class="w-heading-text"><h2 class="w-heading-title">${opts.lead ?? ""}${esc(opts.title)}</h2>${opts.meta ? `<p class="w-heading-meta">${opts.meta}</p>` : ""}</div>${opts.actions ? `<div class="w-heading-actions">${opts.actions}</div>` : ""}</div>`;
}
