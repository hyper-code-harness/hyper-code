/**
 * Draws the address row of a view tab: back, forward, reload, the address and "open in a new tab".
 * @param opts.url The address shown.
 * @param opts.back What back does; omit to disable.
 * @param opts.forward What forward does; omit to disable.
 * @param opts.reload What reload does.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The address shown. */
    url: string;
    /** What back does; omit to disable. */
    back?: types.w.Action;
    /** What forward does; omit to disable. */
    forward?: types.w.Action;
    /** What reload does. */
    reload?: types.w.Action;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const btn = (icon: string, label: string, a?: types.w.Action) => a ? ctx.fns.w.iconButton({ icon, label, action: a, size: 24 }) : `<button class="w-icon-button" data-size="24" disabled aria-label="${label}">${ctx.fns.w.icon({ name: icon, size: 14 })}</button>`;
    return `<div class="w-address">${btn("arrow-left", "Back", opts.back)}${btn("arrow-right", "Forward", opts.forward)}${btn("arrow-clockwise", "Reload", opts.reload ?? { action: "reload" })}<input class="w-address-input" value="${esc(opts.url)}" spellcheck="false" aria-label="Address">${ctx.fns.w.iconButton({ icon: "arrow-square-out", label: "Open in a new tab", action: { href: opts.url }, size: 24 })}</div>`;
}
