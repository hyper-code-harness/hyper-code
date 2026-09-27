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
        /** SSH host alias from ~/.ssh/config (see remote.servers), or "local"; omitted means the agent workspace (remote when workspace.set gave it a host). */
        host?: string;
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
    // Where this call acts: explicit host, "local", or the agent's workspace host.
    const at = ctx.fns.workspace.target({ host: opts.host, path: opts.path });
    const host = at.host ?? undefined;
    const path = host ? at.path : opts.path;
    if (host && !opts.hashline && /\.(png|jpe?g|gif|webp)$/i.test(opts.path)) {
        const { tmpdir } = await import("node:os");
        const { join, extname } = await import("node:path");
        const { mkdtemp, rm } = await import("node:fs/promises");
        // Private per-call directory, removed once the image is in memory.
        const dir = await mkdtemp(join(tmpdir(), "hyper-remote-"));
        let image: types.tools.Content;
        try {
            const local = join(dir, "image" + extname(opts.path));
            await ctx.fns.remote.rsync({ host, direction: "pull", remote: path, local });
            image = await ctx.fns.agent.imageContent({ path: local });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
        return { output: `[image: ${host}:${path}]`, content: [image] };
    }
    if (!opts.hashline && /\.(png|jpe?g|gif|webp)$/i.test(opts.path)) {
        const path = ctx.fns.workspace.resolve({ path: opts.path });
        const image = await ctx.fns.agent.imageContent({ path });
        return { output: `[image: ${opts.path}]`, content: [image] };
    }
    if (opts.hashline) {
        const r = await ctx.fns.files.readHashline({
            path, host, startLine: opts.startLine, endLine: opts.endLine, maxLines: opts.maxLines,
        });
        return r.text;
    }
    const text = await ctx.fns.files.read({ path, host });
    const start = Math.max(1, opts.startLine ?? 1);
    const lines = text.replaceAll("\r\n", "\n").split("\n");
    let end = Math.max(start, opts.endLine ?? lines.length);
    if (opts.maxLines != null) end = Math.min(end, start + Math.max(0, opts.maxLines - 1));
    return lines.slice(start - 1, end).join("\n");
}
