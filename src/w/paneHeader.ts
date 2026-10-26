/**
 * Draws the 32px grey header row of a pane: a leading icon or element, a title with quiet meta, and actions on
 * the right. One header for the side panel, the canvas, the chat and every page pane.
 * @param opts.title Pane title.
 * @param opts.meta Quiet text after the title (an id, a count).
 * @param opts.lead Trusted HTML before the title (an icon, a chat icon that opens a panel).
 * @param opts.actions Trusted HTML of the buttons on the right (iconButtons).
 * @param opts.center Trusted HTML that replaces the title (e.g. tabs).
 * @param opts.attrs Behaviour hooks on the header (w.hooks): data-*, aria-*, id — for page scripts and CSS of the page.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Pane title. */
    title?: string;
    /** Quiet text after the title (an id, a count). */
    meta?: string;
    /** Trusted HTML before the title (an icon, a chat icon that opens a panel). */
    lead?: string;
    /** Trusted HTML of the buttons on the right (iconButtons). */
    actions?: string;
    /** Trusted HTML that replaces the title (e.g. tabs). */
    center?: string;
    /** Behaviour hooks on the header (w.hooks): data-*, aria-*, id — for page scripts and CSS of the page. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const title = opts.center ? `<span class="w-pane-center">${opts.center}</span>` : (opts.title ? `<span class="w-pane-title">${esc(opts.title)}${opts.meta ? ` <span class="w-pane-meta">${esc(opts.meta)}</span>` : ""}</span>` : "<span></span>");
    return `<header class="w-pane-header"${ctx.fns.w.hooks({ attrs: opts.attrs })}>${opts.lead ? `<span class="w-pane-lead">${opts.lead}</span>` : ""}${title}${opts.actions ? `<span class="w-pane-actions">${opts.actions}</span>` : ""}</header>`;
}
