/**
 * Draws Markdown the way chat answers and memory pages do — headings, lists, tables, quotes, inline and fenced
 * code (highlighted, themed), and diagram fences (mermaid, reladraw) — styled only by the widget tokens, so it
 * follows the theme.
 * @param opts.source Markdown text.
 * @param opts.size Text size: compact for side panes, regular for pages. @default "regular"
 * @param opts.baseDir Folder of the Markdown file, so its relative images resolve (a file preview).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Markdown text. */
    source: string;
    /** Text size: compact for side panes, regular for pages. @default "regular" */
    size?: "compact" | "regular";
    /** Folder of the Markdown file, so its relative images resolve (a file preview). */
    baseDir?: string;
}): Promise<string> {
    const html = await ctx.fns.markdown.render({ source: String(opts.source ?? ""), fileBaseDir: opts.baseDir });
    return `<div class="w-markdown" data-size="${opts.size ?? "regular"}">${ctx.fns.rpc.cleanHtml({ html })}</div>`;
}
