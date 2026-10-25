/**
 * Draws a square icon-only button (24 or 28 px) — the control of every header, bar and toolbar.
 * @param opts.icon Phosphor icon name without the ph- prefix.
 * @param opts.label What it does; the tooltip and the accessible name.
 * @param opts.action What happens on click.
 * @param opts.size Square size in px. @default 28
 * @param opts.pressed Shows the on state of a toggle.
 * @param opts.badge Small count or mark on the icon.
 * @param opts.tone Colour meaning of the icon. @default "neutral"
 * @param opts.disabled Shown but not clickable (one opacity, no hover).
 * @param opts.marks Automation markers written as data-* (action, entity, id, status, role) — the w.marks keys.
 * @param opts.submit Submits its form: true, or the name and value the button adds to the submitted fields.
 * @param opts.attrs Behaviour hooks (w.hooks): data-*, aria-*, hx-confirm, onclick, id, popovertarget.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Phosphor icon name without the ph- prefix. */
    icon: string;
    /** What it does; the tooltip and the accessible name. */
    label: string;
    /** What happens on click. */
    action?: types.w.Action;
    /** Square size in px. @default 28 */
    size?: 24 | 28;
    /** Shows the on state of a toggle. */
    pressed?: boolean;
    /** Small count or mark on the icon. */
    badge?: string | number;
    /** Colour meaning of the icon. @default "neutral" */
    tone?: types.w.Tone;
    /** Shown but not clickable (one opacity, no hover). */
    disabled?: boolean;
    /** Automation markers written as data-* (action, entity, id, status, role) — the w.marks keys. */
    marks?: { action?: string; entity?: string; id?: string; status?: string; role?: string };
    /** Submits its form: true, or the name and value the button adds to the submitted fields. */
    submit?: boolean | { name: string; value?: string };
    /** Behaviour hooks (w.hooks): data-*, aria-*, hx-confirm, onclick, id, popovertarget. */
    attrs?: Record<string, string | number | boolean | null | undefined>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    if (opts.submit && opts.action) throw new Error("w.iconButton: submit and action are exclusive — a submit button does what its form does");
    const submit = opts.submit ? ` type="submit"${typeof opts.submit === "object" ? ` name="${esc(opts.submit.name)}" value="${esc(opts.submit.value ?? "1")}"` : ""}` : "";
    const { tag, attrs } = submit ? { tag: "button" as const, attrs: submit } : ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" || opts.disabled ? "button" : tag;
    const badge = opts.badge !== undefined && opts.badge !== "" && opts.badge !== 0 ? `<span class="w-badge-mark">${esc(opts.badge)}</span>` : "";
    const marks = opts.marks ? ` ${ctx.fns.w.marks(opts.marks)}`.replace(/ $/, "") : "";
    const pressed = opts.pressed !== undefined && t === "button" ? ` aria-pressed="${!!opts.pressed}"` : "";
    return `<${t} class="w-icon-button" data-size="${opts.size ?? 28}"${marks}${ctx.fns.w.hooks({ attrs: opts.attrs })}${opts.tone ? ` data-tone="${opts.tone}"` : ""}${pressed}${t === "button" ? ` title="${esc(opts.label)}"` : ""} aria-label="${esc(opts.label)}"${opts.disabled ? ' type="button" disabled' : (attrs || ' type="button"')}>${ctx.fns.w.icon({ name: opts.icon, size: (opts.size ?? 28) === 24 ? 14 : 16 })}${badge}</${t}>`;
}
