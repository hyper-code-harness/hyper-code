/**
 * Draws Markdown as the chat and memory pages do (fences such as mermaid render too), cleaned for the page.
 * @param opts.source Markdown text.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Markdown text. */
    source: string;
}): Promise<string> {
    const html = await ctx.fns.markdown.render({ source: String(opts.source ?? "") });
    return `<div class="w-markdown prose prose-sm max-w-none">${ctx.fns.rpc.cleanHtml({ html })}</div>`;
}
