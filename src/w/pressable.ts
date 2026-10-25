/**
 * Draws a bare clickable element — a button, or a link when the action is an href — with no look of its own: the
 * Action, the data-* automation markers and behaviour hooks, and trusted content. Use it only for chrome whose look
 * is owned by the stylesheet of its container (the dock, the model picker rows, a message menu), where w.button or
 * w.iconButton would draw a second look; everything else is w.button, w.iconButton or w.listRow.
 * @param opts.html Trusted content (icon, text).
 * @param opts.label Accessible name and tooltip, for content without words.
 * @param opts.title Tooltip text when it differs from the label.
 * @param opts.action What happens on click.
 * @param opts.submit Submits its form: true, or the name and value the button adds to the submitted fields.
 * @param opts.marks Automation markers written as data-* (action, entity, id, status, role) — the w.marks keys.
 * @param opts.attrs Behaviour hooks (w.hooks): data-*, aria-*, hx-confirm, onclick, id, form, popovertarget.
 * @param opts.class Class names of the container stylesheet that draws this element.
 * @param opts.disabled Not clickable.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted content (icon, text). */
    html: string;
    /** Accessible name and tooltip, for content without words. */
    label?: string;
    /** Tooltip text when it differs from the label. */
    title?: string;
    /** What happens on click. */
    action?: types.w.Action;
    /** Submits its form: true, or the name and value the button adds to the submitted fields. */
    submit?: boolean | { name: string; value?: string };
    /** Automation markers written as data-* (action, entity, id, status, role) — the w.marks keys. */
    marks?: { action?: string; entity?: string; id?: string; status?: string; role?: string };
    /** Behaviour hooks (w.hooks): data-*, aria-*, hx-confirm, onclick, id, form, popovertarget. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
    /** Class names of the container stylesheet that draws this element. */
    class?: string;
    /** Not clickable. */
    disabled?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    if (opts.submit && opts.action) throw new Error("w.pressable: submit and action are exclusive — a submit button does what its form does");
    const marks = opts.marks ? ctx.fns.w.marks(opts.marks) : "";
    const title = opts.title ?? opts.label;
    const head = `${opts.class ? ` class="${esc(opts.class)}"` : ""}${marks ? ` ${marks}` : ""}${title ? ` title="${esc(title)}"` : ""}${opts.label ? ` aria-label="${esc(opts.label)}"` : ""}${ctx.fns.w.hooks({ attrs: opts.attrs })}`;
    if (opts.submit) {
        const nv = typeof opts.submit === "object" ? ` name="${esc(opts.submit.name)}" value="${esc(opts.submit.value ?? "1")}"` : "";
        return `<button type="submit"${head}${nv}${opts.disabled ? " disabled" : ""}>${opts.html}</button>`;
    }
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" || opts.disabled ? "button" : tag;
    return `<${t}${head}${opts.disabled ? ' type="button" disabled' : (attrs || ' type="button"')}>${opts.html}</${t}>`;
}
