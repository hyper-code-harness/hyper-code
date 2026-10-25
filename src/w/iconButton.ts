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
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" || opts.disabled ? "button" : tag;
    const badge = opts.badge !== undefined && opts.badge !== "" && opts.badge !== 0 ? `<span class="w-badge-mark">${esc(opts.badge)}</span>` : "";
    const pressed = opts.pressed !== undefined && t === "button" ? ` aria-pressed="${!!opts.pressed}"` : "";
    return `<${t} class="w-icon-button" data-size="${opts.size ?? 28}"${opts.tone ? ` data-tone="${opts.tone}"` : ""}${pressed}${t === "button" ? ` title="${esc(opts.label)}"` : ""} aria-label="${esc(opts.label)}"${opts.disabled ? ' type="button" disabled' : (attrs || ' type="button"')}>${ctx.fns.w.icon({ name: opts.icon, size: (opts.size ?? 28) === 24 ? 14 : 16 })}${badge}</${t}>`;
}
