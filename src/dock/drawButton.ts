/**
 * Draws one Dock button from a data description, so every entry has the same size, badge and tooltip.
 *
 * A button with `popup` opens that trusted HTML in a popover beside the Dock; otherwise it is a link to `href`.
 * @param opts.id Dock entry id, used for the DOM id and automation.
 * @param opts.button The button description returned by an entry's render.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Dock entry id, used for the DOM id and automation. */
        id: string;
        /** Button description returned by an entry's render. */
        button: types.dock.Button;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const b = opts.button;
    const icon = /^ph-[a-z0-9-]+$/.test(String(b.icon ?? "")) ? b.icon : "ph-circle";
    const badge = b.badge === null || b.badge === undefined || b.badge === 0 || b.badge === "" ? "" :
        `<span class="pointer-events-none absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[0.55rem] font-semibold leading-none tabular-nums text-primary-content">${esc(b.badge)}</span>`;
    const face = `<i class="ph ${esc(icon)} text-base" aria-hidden="true"></i>${badge}`;
    const cls = "relative flex size-7 items-center justify-center rounded-md text-subtle hover:bg-base-300 hover:text-base-content";
    if (b.popup) {
        return await ctx.fns.ui.inplacePopup({
            id: `dock-${opts.id}-popup`,
            triggerHtml: face,
            triggerAttrs: `class="${cls}" title="${esc(b.label)}" aria-label="${esc(b.label)}"`,
            panelAttrs: `aria-label="${esc(b.label)}" data-placement="side"`,
            contentHtml: b.popup,
        });
    }
    return `<a href="${esc(b.href ?? "#")}" class="${cls}" title="${esc(b.label)}" aria-label="${esc(b.label)}">${face}</a>`;
}
