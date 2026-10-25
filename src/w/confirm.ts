/**
 * Draws a confirmation for a risky action: a native dialog with the question, Cancel and the action button
 * (red for destructive). Opened by a button with popover/dialog id; the action posts with htmx.
 * @param opts.id Dialog id the opener refers to.
 * @param opts.title The question.
 * @param opts.text What will happen.
 * @param opts.confirmLabel Label of the action button. @default "Confirm"
 * @param opts.action What the action button does.
 * @param opts.danger The action destroys something. @default false
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Dialog id the opener refers to. */
    id: string;
    /** The question. */
    title: string;
    /** What will happen. */
    text?: string;
    /** Label of the action button. @default "Confirm" */
    confirmLabel?: string;
    /** What the action button does. */
    action: types.w.Action;
    /** The action destroys something. @default false */
    danger?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" ? "button" : tag;
    const id = String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    return `<div id="${id}" popover="manual" class="w-confirm" role="alertdialog" aria-label="${esc(opts.title)}"><div class="w-confirm-title">${esc(opts.title)}</div>${opts.text ? `<div class="w-confirm-text">${esc(opts.text)}</div>` : ""}<div class="w-confirm-actions"><button type="button" class="w-btn" popovertarget="${id}" popovertargetaction="hide">Cancel</button><${t} class="w-btn" data-tone="${opts.danger ? "danger" : "accent"}"${attrs} popovertarget="${id}" popovertargetaction="hide">${esc(opts.confirmLabel ?? "Confirm")}</${t}></div></div>`;
}
