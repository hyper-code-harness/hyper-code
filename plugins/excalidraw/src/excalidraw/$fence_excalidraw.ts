// ```excalidraw fences show a saved drawing inline: the block holds the drawing
// name, the fence renders its exported SVG preview with a link to the editor.

/** One line in the system prompt's fence index. */
export const hint = "a saved hand-drawn Excalidraw sketch by name (create it with excalidraw.write from a Mermaid source or element skeleton; the user edits it at /excalidraw/<name>); the block body is just the drawing name; info string `edit` embeds the live editor right in the chat (```excalidraw edit), height=<px> sets its height";

/**
 * Renders a ```excalidraw fence: the saved drawing's SVG preview plus an edit link, or with `edit` in the info string the live editor in an iframe.
 * @param opts.source Drawing name inside the fence.
 * @param opts.info Fence info string: `edit` embeds the editor, `height=<px>` sets its height.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    const name = String(opts.source ?? "").trim().split(/\s+/)[0] ?? "";
    const info = String(opts.info ?? "");
    if (/\bedit\b/.test(info)) {
        const f = await ctx.fns.excalidraw.file({ name });
        const h = /height=(\d+)/.exec(info)?.[1];
        const height = h ? `${Math.min(1200, Math.max(240, Number(h)))}px` : "70vh";
        const src = `/excalidraw/${encodeURIComponent(f.name)}?embed=1`;
        return `<figure class="excalidraw-fence excalidraw-live" style="width:max(100%, 90cqw);margin:0.75rem 0 0.75rem calc(50% - max(50%, 45cqw));border:1px solid rgba(127,127,127,.3);border-radius:8px;overflow:hidden;background:#fff"><iframe src="${src}" title="Excalidraw: ${Bun.escapeHTML(f.name)}" loading="lazy" style="display:block;width:100%;height:${height};min-height:320px;border:0;background:#fff"></iframe></figure>`;
    }
    const d = await ctx.fns.excalidraw.read({ name });
    if (!d.exists) throw new Error(`excalidraw: no drawing "${name}"`);
    const url = `/excalidraw/${encodeURIComponent(d.name)}`;
    const link = `<a href="${url}" target="_blank" rel="noopener">✏️ ${Bun.escapeHTML(d.name)} — открыть в Excalidraw</a>`;
    if (!d.svg) return `<figure class="excalidraw-fence"><figcaption>${link} (превью появится после первого открытия)</figcaption></figure>`;
    return `<figure class="excalidraw-fence">${ctx.fns.excalidraw.cleanSvg({ svg: d.svg })}<figcaption>${link}</figcaption></figure>`;
}
