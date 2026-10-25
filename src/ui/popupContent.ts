/** Performs the ui.popupContent runtime operation. */
/**
 * Render the standard content wrapper for a popup.
 * @param opts.title Displayed title.
 * @param opts.html Initial or inner HTML content.
 * @param opts.kind Popup presentation variant.
 * @param opts.class Additional CSS classes.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Page title. */ title: string;
        /** Rendered HTML content. */ html: string;
        /** Notification severity. */ kind?: string;
        /** Value used for the class option. */ class?: string },
): string {
    const esc = (s: any) => ctx.fns.w.escape({ text: s });
    return `<section data-popup-content data-popup-title="${esc(opts.title)}" data-popup-kind="${esc(opts.kind ?? '')}" class="${esc(opts.class ?? 'w-full')}">${opts.html}</section>`;
}
