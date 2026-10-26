/**
 * Draws progress as a small ring with the value inside or beside it (context use, quota, plan progress).
 * @param opts.value Current value.
 * @param opts.max Full value. @default 100
 * @param opts.label Text beside the ring.
 * @param opts.tone Colour; omit to colour by fill (warning at 70%, danger at 90%).
 * @param opts.size Diameter in px. @default 20
 * @param opts.action What a click does (open the compact popup): the ring becomes a round button.
 * @param opts.title Tooltip and accessible name of the button (what the number means and what a click does).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Current value. */
    value: number;
    /** Full value. @default 100 */
    max?: number;
    /** Text beside the ring. */
    label?: string;
    /** Colour; omit to colour by fill (warning at 70%, danger at 90%). */
    tone?: types.w.Tone;
    /** Diameter in px. @default 20 */
    size?: 16 | 20 | 28;
    /** What a click does (open the compact popup): the ring becomes a round button. */
    action?: types.w.Action;
    /** Tooltip and accessible name of the button (what the number means and what a click does). */
    title?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const share = Math.max(0, Math.min(1, Number(opts.value) / Number(opts.max ?? 100) || 0));
    const tone = opts.tone ?? (share >= 0.9 ? "danger" : share >= 0.7 ? "warning" : "neutral");
    const size = opts.size ?? 20;
    const ring = (title: string) => `<span class="w-ring" data-tone="${tone}"${title}><svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke-width="2.5" class="w-ring-track"/><circle cx="10" cy="10" r="8" fill="none" stroke-width="2.5" stroke-linecap="round" pathLength="100" stroke-dasharray="${(share * 100).toFixed(1)} 100" transform="rotate(-90 10 10)" class="w-ring-fill"/></svg>${opts.label ? `<span>${esc(opts.label)}</span>` : ""}</span>`;
    if (!opts.action) return ring(` title="${esc(opts.title ?? `${Math.round(share * 100)}%`)}"`);
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" ? "button" : tag;
    const name = esc(opts.title ?? `${Math.round(share * 100)}%`);
    return `<${t} class="w-ring-button" title="${name}" aria-label="${name}"${attrs || ' type="button"'}>${ring("")}</${t}>`;
}
