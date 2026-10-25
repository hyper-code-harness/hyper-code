/**
 * Draws a control that opens a panel or a menu where it is not on a rail — or where it could read as plain text,
 * like a title: an optional lead (icon), the label, quiet meta, and a chevron ⌄ that says "this opens". Hover is a
 * grey backing on the whole group; while its popover is open the group is light blue and the chevron points up.
 * @param opts.label The visible label (a title, a name).
 * @param opts.popover Id of the popover or menu it opens (w.popover / w.menu).
 * @param opts.lead Trusted HTML before the label (an icon, a chat icon).
 * @param opts.meta Quiet text after the label (an id, a count).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The visible label (a title, a name). */
    label: string;
    /** Id of the popover or menu it opens (w.popover / w.menu). */
    popover: string;
    /** Trusted HTML before the label (an icon, a chat icon). */
    lead?: string;
    /** Quiet text after the label (an id, a count). */
    meta?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const { attrs } = ctx.fns.w.actionAttrs({ action: { popover: opts.popover } });
    return `<button class="w-disclosure"${attrs}>${opts.lead ?? ""}<span class="w-disclosure-label">${esc(opts.label)}</span>${opts.meta ? `<span class="w-disclosure-meta">${esc(opts.meta)}</span>` : ""}${ctx.fns.w.icon({ name: "caret-down", size: 12 })}</button>`;
}
