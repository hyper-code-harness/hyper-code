// Read a file, optionally a line range, optionally in hashline form (anchors
// instead of line numbers — what `edit` consumes). Declared by $tool_read.md;
// callable by hand as ctx.fns.tools.read({ path, hashline: true }).
/**
 * Reads a workspace file as text, a line range, hashline anchors, or an image
 *
 * Returns file text, optionally sliced by line range or prefixed with stable
 * hashline anchors for `edit`. A path ending in .png, .jpg, .jpeg, .gif or .webp
 * returns the image as model-visible content so agents can look at screenshots.
 * @param opts.path File path, relative to the workspace or absolute.
 * @param opts.startLine First line to return, one-based. @default 1 @minimum 1
 * @param opts.endLine Last line to return, inclusive; omitted means end of file. @minimum 1
 * @param opts.maxLines Maximum number of lines to return. @minimum 1
 * @param opts.hashline Prefix each line with a stable anchor for edit. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** File path, relative to the workspace or absolute. */
        path: string;
        /** First line to return, one-based. @default 1 @minimum 1 */
        startLine?: number;
        /** Last line to return, inclusive; omitted means end of file. @minimum 1 */
        endLine?: number;
        /** Maximum number of lines to return. @minimum 1 */
        maxLines?: number;
        /** Prefix each line with a stable anchor for edit. @default false */
        hashline?: boolean;
    },
): Promise<string | { output: string; content: types.tools.Content[] }> {
    // An image path returns the picture itself as model-visible content, so
    // "read the screenshot" works the same way for every agent and provider.
    if (!opts.hashline && /\.(png|jpe?g|gif|webp)$/i.test(opts.path)) {
        const path = ctx.fns.workspace.resolve({ path: opts.path });
        const image = await ctx.fns.agent.imageContent({ path });
        return { output: `[image: ${opts.path}]`, content: [image] };
    }
    if (opts.hashline) {
        const r = await ctx.fns.files.readHashline({
            path: opts.path, startLine: opts.startLine, endLine: opts.endLine, maxLines: opts.maxLines,
        });
        return r.text;
    }
    const text = await ctx.fns.files.read({ path: opts.path });
    const start = Math.max(1, opts.startLine ?? 1);
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    let end = Math.max(start, opts.endLine ?? lines.length);
    if (opts.maxLines != null) end = Math.min(end, start + Math.max(0, opts.maxLines - 1));
    return lines.slice(start - 1, end).join("\n");
}
