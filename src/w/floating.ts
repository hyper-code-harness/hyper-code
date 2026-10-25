/**
 * Draws a floating card over the page — the folded chat strip, a mini player — with a grip to move it and a
 * corner to resize it (ui/hotkeys.js, kept per key in this browser).
 * @param opts.body Trusted HTML inside.
 * @param opts.key Name under which position and size are remembered.
 * @param opts.draggable Show the grip. @default true
 * @param opts.resizable Show the resize corner. @default true
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML inside. */
    body: string;
    /** Name under which position and size are remembered. */
    key?: string;
    /** Show the grip. @default true */
    draggable?: boolean;
    /** Show the resize corner. @default true */
    resizable?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    return `<div class="w-floating"${opts.key ? ` data-floating-key="${esc(opts.key)}"` : ""}>${opts.draggable === false ? "" : '<span class="w-floating-grip" aria-hidden="true"></span>'}${opts.resizable === false ? "" : '<span class="w-floating-corner" aria-hidden="true"></span>'}${opts.body}</div>`;
}
