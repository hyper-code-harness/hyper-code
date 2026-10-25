/**
 * Draws two panes side by side with a 1px line between them that is also the width handle (ui/hotkeys.js drags
 * it and keeps the width per key in this browser).
 * @param opts.start Trusted HTML of the left pane.
 * @param opts.end Trusted HTML of the right pane.
 * @param opts.size Width of the right pane in px. @default 420
 * @param opts.min Smallest width of either pane in px. @default 280
 * @param opts.key Name under which the chosen width is remembered.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the left pane. */
    start: string;
    /** Trusted HTML of the right pane. */
    end: string;
    /** Width of the right pane in px. @default 420 */
    size?: number;
    /** Smallest width of either pane in px. @default 280 */
    min?: number;
    /** Name under which the chosen width is remembered. */
    key?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    return `<div class="w-split" style="--w-split-end:${Math.round(opts.size ?? 420)}px;--w-split-min:${Math.round(opts.min ?? 280)}px"${opts.key ? ` data-split-key="${esc(opts.key)}"` : ""}><div class="w-split-start">${opts.start}</div><div class="w-split-handle" role="separator" aria-orientation="vertical" tabindex="0"></div><div class="w-split-end">${opts.end}</div></div>`;
}
