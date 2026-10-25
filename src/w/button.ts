/**
 * Draws a text button with an optional icon: neutral (white with a line), primary (ink — the one main action of a
 * view), danger, super (the rare super accent) or ghost; two sizes.
 * @param opts.label Button text.
 * @param opts.icon Phosphor icon before the text.
 * @param opts.action What happens on click.
 * @param opts.tone Meaning: primary is the one main action (ink); accent is an old name for it. @default "neutral"
 * @param opts.size Height. @default "md"
 * @param opts.disabled Not clickable.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Button text. */
    label: string;
    /** Phosphor icon before the text. */
    icon?: string;
    /** What happens on click. */
    action?: types.w.Action;
    /** Meaning: primary is the one main action (ink); accent is an old name for it. @default "neutral" */
    tone?: "neutral" | "primary" | "accent" | "danger" | "super" | "ghost";
    /** Height. @default "md" */
    size?: "sm" | "md";
    /** Not clickable. */
    disabled?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" || opts.disabled ? "button" : tag;
    return `<${t} class="w-btn" data-tone="${opts.tone ?? "neutral"}" data-size="${opts.size ?? "md"}"${opts.disabled ? " disabled" : (attrs || ' type="button"')}>${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: opts.size === "sm" ? 14 : 16 }) : ""}<span>${esc(opts.label)}</span></${t}>`;
}
