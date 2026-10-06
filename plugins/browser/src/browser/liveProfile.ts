// Live-view picture profile: JPEG quality and the largest frame size Chrome
// should encode, from the viewer's mode, its canvas box and an adaptive level.
// Chrome scales the frame down before encoding (Page.startScreencast maxWidth /
// maxHeight), so a smaller level means fewer pixels to encode, send and decode.

const LEVELS = [
    { quality: 0, scale: 0 },      // 0: the configured quality, viewer device pixels (box × DPR)
    { quality: 60, scale: 1 },     // 1: CSS pixels of the viewer box
    { quality: 45, scale: 0.75 },
    { quality: 30, scale: 0.5 },   // 3: lowest
] as const;

/**
 * Computes the screencast parameters (JPEG quality, maxWidth, maxHeight) for one live-view viewer.
 *
 * Use when starting or restarting `Page.startScreencast` for the live view. Mode `high` is level 0
 * (configured quality, viewer device pixels), `low` is level 3 (quality 30, half the viewer box), `auto`
 * uses the given adaptive level 0–3. Without a known viewer box no size limit is set.
 * @param opts.mode Viewer choice: `auto`, `high` or `low`. @default "auto"
 * @param opts.level Adaptive level for `auto`, 0 best to 3 lowest. @default 1 @minimum 0 @maximum 3
 * @param opts.width Viewer canvas box width in CSS pixels; 0 when unknown. @default 0
 * @param opts.height Viewer canvas box height in CSS pixels; 0 when unknown. @default 0
 * @param opts.dpr Viewer devicePixelRatio, used at level 0. @default 1 @minimum 1 @maximum 3
 * @param opts.baseQuality Configured JPEG quality used at level 0. @default 70 @minimum 10 @maximum 100
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Viewer choice: `auto`, `high` or `low`. @default "auto" */
        mode?: "auto" | "high" | "low";
        /** Adaptive level for `auto`, 0 best to 3 lowest. @default 1 @minimum 0 @maximum 3 */
        level?: number;
        /** Viewer canvas box width in CSS pixels; 0 when unknown. @default 0 */
        width?: number;
        /** Viewer canvas box height in CSS pixels; 0 when unknown. @default 0 */
        height?: number;
        /** Viewer devicePixelRatio, used at level 0. @default 1 @minimum 1 @maximum 3 */
        dpr?: number;
        /** Configured JPEG quality used at level 0. @default 70 @minimum 10 @maximum 100 */
        baseQuality?: number;
    },
): { level: number; quality: number; maxWidth?: number; maxHeight?: number } {
    const mode = opts.mode ?? "auto";
    const level = mode === "high" ? 0 : mode === "low" ? 3 : Math.max(0, Math.min(3, Math.trunc(opts.level ?? 1)));
    const base = Math.max(10, Math.min(100, Math.trunc(opts.baseQuality ?? 70)));
    const spec = LEVELS[level] ?? LEVELS[1];
    const quality = level === 0 ? base : Math.min(base, spec.quality);
    const scale = level === 0 ? Math.max(1, Math.min(3, opts.dpr ?? 1)) : spec.scale;
    const w = Number(opts.width) || 0, h = Number(opts.height) || 0;
    if (w <= 0 || h <= 0) return { level, quality };
    const side = (v: number) => Math.max(160, Math.min(4096, Math.round(v * scale)));
    return { level, quality, maxWidth: side(w), maxHeight: side(h) };
}
