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
    const w = ctx.fns.w;
    const b = opts.button;
    const icon = /^ph-[a-z0-9-]+$/.test(String(b.icon ?? "")) ? String(b.icon).slice(3) : "circle";
    const badge = b.badge === null || b.badge === undefined ? undefined : b.badge;
    if (b.popup) {
        const id = `dock-${opts.id}-popup`.replace(/[^a-zA-Z0-9_-]/g, "-");
        return w.popover({ id, label: b.label, placement: "side", body: b.popup, trigger: w.railItem({ label: b.label, icon, badge, action: { popover: id } }) });
    }
    return w.railItem({ label: b.label, icon, badge, action: { href: b.href ?? "#" } });
}
