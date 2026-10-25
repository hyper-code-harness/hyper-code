/**
 * Draws Markdown the way chat answers and memory pages do — headings, lists, tables, quotes, inline and fenced
 * code (highlighted, themed), and diagram fences (mermaid, reladraw) — styled only by the widget tokens, so it
 * follows the theme.
 * @param opts.source Markdown text.
 * @param opts.size Text size: compact for side panes, regular for pages. @default "regular"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Markdown text. */
    source: string;
    /** Text size: compact for side panes, regular for pages. @default "regular" */
    size?: "compact" | "regular";
}): Promise<string> {
    const html = await ctx.fns.markdown.render({ source: String(opts.source ?? "") });
    return `<div class="w-markdown" data-size="${opts.size ?? "regular"}">${ctx.fns.rpc.cleanHtml({ html })}</div>`;
}
