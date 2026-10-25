/**
 * Draws a small label or count in a tone (neutral, info, success, warning, danger, accent).
 * @param opts.text Label text.
 * @param opts.tone Meaning. @default "neutral"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Label text. */
    text: string | number;
    /** Meaning. @default "neutral" */
    tone?: types.w.Tone;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    return `<span class="w-badge" data-tone="${opts.tone ?? "neutral"}">${esc(opts.text)}</span>`;
}
