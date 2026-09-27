// ```mermaid fences in Markdown (chat, docs, SKILL.md pages) render as inline
// diagrams through mermaid.render. A block that fails stays a code block.

/**
 * Renders a ```mermaid fence as an inline, responsive SVG diagram.
 * @param opts.source Mermaid source inside the fence.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; lang: string; info: string }): Promise<string> {
    return ctx.fns.mermaid.render({ source: opts.source });
}
