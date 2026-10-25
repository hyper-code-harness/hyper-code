/**
 * Draws a text button with an optional icon: default, accent (the main action), danger, or ghost; two sizes.
 * @param opts.label Button text.
 * @param opts.icon Phosphor icon before the text.
 * @param opts.action What happens on click.
 * @param opts.tone Look. @default "neutral"
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
    /** Look. @default "neutral" */
    tone?: "neutral" | "accent" | "danger" | "ghost";
    /** Height. @default "md" */
    size?: "sm" | "md";
    /** Not clickable. */
    disabled?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action ?? {} });
    const t = tag === "span" || opts.disabled ? "button" : tag;
    return `<${t} class="w-btn" data-tone="${opts.tone ?? "neutral"}" data-size="${opts.size ?? "md"}"${opts.disabled ? " disabled" : (attrs || ' type="button"')}>${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 14 }) : ""}<span>${esc(opts.label)}</span></${t}>`;
}
