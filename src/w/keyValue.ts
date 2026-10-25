/**
 * Draws key — value pairs in one or two columns (agent facts, file metadata, settings summaries).
 * @param opts.items Pairs; value is text or trusted HTML.
 * @param opts.cols Columns. @default 1
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Pairs; value is text or trusted HTML. */
    items: Array<{ key: string; value?: string | number; html?: string }>;
    /** Columns. @default 1 */
    cols?: 1 | 2;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    return `<dl class="w-kv" data-cols="${opts.cols ?? 1}">${opts.items.map(it => `<div><dt>${esc(it.key)}</dt><dd>${it.html ?? esc(it.value ?? "—")}</dd></div>`).join("")}</dl>`;
}
