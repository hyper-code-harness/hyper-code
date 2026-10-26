/**
 * Draws a text button with an optional icon: neutral (white with a line), primary (ink — the one main action of a
 * view), danger, super (the rare super accent) or ghost; two sizes. Also the submit button of a form (submit), and
 * carries the data-* automation markers (marks) that page.click and the agent's helpers find controls by.
 * @param opts.label Button text.
 * @param opts.icon Phosphor icon before the text.
 * @param opts.action What happens on click.
 * @param opts.tone Meaning: primary is the one main action (ink); accent is an old name for it; danger, warning and success draw an outline in their colour. @default "neutral"
 * @param opts.size Height. @default "md"
 * @param opts.disabled Not clickable.
 * @param opts.submit Submits its form: true, or the name and value the button adds to the submitted fields.
 * @param opts.marks Automation markers written as data-* (action, entity, id, status, role) — the w.marks keys.
 * @param opts.title Tooltip text.
 * @param opts.keys Keyboard shortcut shown after the label as key caps (w.kbd), e.g. "J" or "⌘+Enter".
 * @param opts.id Element id, for a page script or a hotkey that clicks this button.
 * @param opts.attrs Behaviour hooks (w.hooks): data-*, aria-*, hx-confirm, onclick, form, popovertarget.
 * A button that opens a popover or menu (action { popover }) ends with a caret, so it reads as a drop-down.
 * @param opts.wide Fills the width of its row (a form's one submit, a card's footer action).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Button text. */
    label: string;
    /** Phosphor icon before the text. */
    icon?: string;
    /** What happens on click. */
    action?: types.w.Action;
    /** Meaning: primary is the one main action (ink); accent is an old name for it; danger, warning and success draw an outline in their colour. @default "neutral" */
    tone?: "neutral" | "primary" | "accent" | "danger" | "warning" | "success" | "super" | "ghost";
    /** Height. @default "md" */
    size?: "sm" | "md";
    /** Not clickable. */
    disabled?: boolean;
    /** Submits its form: true, or the name and value the button adds to the submitted fields. */
    submit?: boolean | { name: string; value?: string };
    /** Automation markers written as data-* (action, entity, id, status, role) — the w.marks keys. */
    marks?: { action?: string; entity?: string; id?: string; status?: string; role?: string };
    /** Tooltip text. */
    title?: string;
    /** Keyboard shortcut shown after the label as key caps (w.kbd), e.g. "J" or "⌘+Enter". */
    keys?: string;
    /** Element id, for a page script or a hotkey that clicks this button. */
    id?: string;
    /** Behaviour hooks (w.hooks): data-*, aria-*, hx-confirm, onclick, form, popovertarget. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
    /** Fills the width of its row (a form's one submit, a card's footer action). */
    wide?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const marks = opts.marks ? ` ${ctx.fns.w.marks(opts.marks)}`.replace(/ $/, "") : "";
    const title = (opts.title ? ` title="${esc(opts.title)}"` : "") + (opts.id ? ` id="${esc(opts.id)}"` : "");
    const body = `${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: opts.size === "sm" ? 14 : 16 }) : ""}<span>${esc(opts.label)}</span>${opts.keys ? ctx.fns.w.kbd({ keys: opts.keys }) : ""}${opts.action?.popover ? `<i class="w-icon w-btn-caret ph ph-caret-down" data-size="12" aria-hidden="true"></i>` : ""}`;
    const head = `class="w-btn" data-tone="${opts.tone ?? "neutral"}" data-size="${opts.size ?? "md"}"${opts.wide ? " data-wide" : ""}${marks}${title}${ctx.fns.w.hooks({ attrs: opts.attrs })}`;
    if (opts.submit) {
        if (opts.action) throw new Error("w.button: submit and action are exclusive — a submit button does what its form does");
        const nv = typeof opts.submit === "object" ? ` name="${esc(opts.submit.name)}" value="${esc(opts.submit.value ?? "1")}"` : "";
        return `<button type="submit" ${head}${nv}${opts.disabled ? " disabled" : ""}>${body}</button>`;
    }
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" || opts.disabled ? "button" : tag;
    return `<${t} ${head}${opts.disabled ? ' type="button" disabled' : (attrs || ' type="button"')}>${body}</${t}>`;
}
