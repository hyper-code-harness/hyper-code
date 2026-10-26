/**
 * Draws a control that opens a panel or a menu where it is not on a rail — or where it could read as plain text,
 * like a title: an optional lead (icon), the label, quiet meta, and a chevron ⌄ that says "this opens". Hover is a
 * grey backing on the whole group; while its popover is open the group is light blue and the chevron points up.
 * @param opts.label The visible label (a title, a name).
 * @param opts.popover Id of the popover or menu it opens (w.popover / w.menu); give popover or popup.
 * @param opts.popup Runtime function it opens in the app popup instead (ui.popup), with its params.
 * @param opts.title Tooltip when it differs from the label (the full model id).
 * @param opts.lead Trusted HTML before the label (an icon, a chat icon).
 * @param opts.meta Quiet text after the label (an id, a count).
 * @param opts.attrs Behaviour hooks (w.hooks): data-*, aria-*, id — for page scripts and tests.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The visible label (a title, a name). */
    label: string;
    /** Id of the popover or menu it opens (w.popover / w.menu); give popover or popup. */
    popover?: string;
    /** Runtime function it opens in the app popup instead (ui.popup), with its params. */
    popup?: { method: string; params?: Record<string, unknown> };
    /** Tooltip when it differs from the label (the full model id). */
    title?: string;
    /** Trusted HTML before the label (an icon, a chat icon). */
    lead?: string;
    /** Quiet text after the label (an id, a count). */
    meta?: string;
    /** Behaviour hooks (w.hooks): data-*, aria-*, id — for page scripts and tests. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    if (!opts.popover === !opts.popup) throw new Error("w.disclosure needs exactly one of popover or popup");
    const { attrs } = ctx.fns.w.actionAttrs({ action: opts.popover ? { popover: opts.popover } : { popup: opts.popup } });
    return `<button class="w-disclosure"${opts.title ? ` title="${esc(opts.title)}"` : ""}${attrs}${ctx.fns.w.hooks({ attrs: opts.attrs })}>${opts.lead ?? ""}<span class="w-disclosure-label">${esc(opts.label)}</span>${opts.meta ? `<span class="w-disclosure-meta">${esc(opts.meta)}</span>` : ""}${ctx.fns.w.icon({ name: "caret-down", size: 12 })}</button>`;
}
