/**
 * Draws a Phosphor icon at one of the widget sizes, in a tone.
 * @param opts.name Phosphor icon name without the ph- prefix, e.g. gear-six.
 * @param opts.size Size in px from the scale. @default 16
 * @param opts.tone Colour meaning; omit to inherit the text colour.
 * @param opts.label Accessible name; omit for a decorative icon.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Phosphor icon name without the ph- prefix, e.g. gear-six. */
    name: string;
    /** Size in px from the scale. @default 16 */
    size?: 12 | 14 | 16 | 20 | 24;
    /** Colour meaning; omit to inherit the text colour. */
    tone?: types.w.Tone;
    /** Accessible name; omit for a decorative icon. */
    label?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const name = String(opts.name ?? "").replace(/^ph-/, "");
    if (!/^[a-z0-9-]+$/.test(name)) return "";
    const a11y = opts.label ? ` role="img" aria-label="${esc(opts.label)}"` : ' aria-hidden="true"';
    return `<i class="w-icon ph ph-${name}" data-size="${opts.size ?? 16}"${opts.tone ? ` data-tone="${opts.tone}"` : ""}${a11y}></i>`;
}
