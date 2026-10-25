/**
 * Draws a "working" mark: a turning arc, a soft glow around content, or skeleton lines while something loads.
 * @param opts.kind Which mark. @default "arc"
 * @param opts.size Arc size in px. @default 16
 * @param opts.lines Skeleton lines. @default 3
 * @param opts.html Content that glows (kind glow).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Which mark. @default "arc" */
    kind?: "arc" | "glow" | "skeleton";
    /** Arc size in px. @default 16 */
    size?: 12 | 16 | 20 | 28;
    /** Skeleton lines. @default 3 */
    lines?: number;
    /** Content that glows (kind glow). */
    html?: string;
}): string {
    const kind = opts.kind ?? "arc";
    if (kind === "skeleton") return `<div class="w-skeleton" aria-busy="true">${Array.from({ length: Math.max(1, Math.min(12, opts.lines ?? 3)) }, () => "<span></span>").join("")}</div>`;
    if (kind === "glow") return `<span class="w-glow" aria-busy="true">${opts.html ?? ""}</span>`;
    return `<span class="w-arc" data-size="${opts.size ?? 16}" role="status" aria-label="working"></span>`;
}
