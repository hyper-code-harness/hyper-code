// ```reladraw fences in Markdown (chat, docs, notes) render as inline diagrams.
// The fence info string may name a theme: ```reladraw light

/** One line in the system prompt's fence index. */
export const hint = "diagrams placed by hand \u2014 right of, below, level with \u2014 when the arrangement carries meaning; info string names a theme";

/**
 * Renders a ```reladraw fence as an inline, responsive SVG diagram.
 * @param opts.source Reladraw source inside the fence.
 * @param opts.info Rest of the fence line; a first word naming a theme applies it.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    const theme = opts.info.split(/\s+/).filter(Boolean)[0];
    const { svg, width } = await ctx.fns.reladraw.render({ source: opts.source, theme: theme || undefined });
    const responsive = svg
        .replace(/^<\?xml[^>]*>\s*/, "")
        .replace(/<svg\b([^>]*?)\swidth="[^"]+"\sheight="[^"]+"/, `<svg$1 width="${width}"`);
    return `<div class="reladraw-diagram">${responsive}</div>`;
}
