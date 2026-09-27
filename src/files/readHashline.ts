/**
 * Reads a workspace or remote SSH file with stable hashline anchors for edits.
 *
 * @param opts.host Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means the local workspace.
 * @param opts.path Workspace-relative or absolute path; with host a remote path relative to the remote home.
 * @param opts.startLine First line to include, one-based. @minimum 1
 * @param opts.endLine Last line to include, inclusive. @minimum 1
 * @param opts.maxLines Maximum number of lines to return. @minimum 1
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means local. */ host?: string; /** Workspace-relative path. */ path: string; /** First line to include, one-based. */ startLine?: number; /** Last line to include, inclusive. */ endLine?: number; /** Maximum number of lines to return. */ maxLines?: number },
): Promise<types.files.ReadHashlineResult> {
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    const content = await ctx.fns.files.read({ path: opts.path, host: opts.host });
    const normalized = content.replaceAll("\r\n", "\n");
    const all = normalized.split("\n");
    const totalLines = all.length;
    const startLine = Math.max(1, opts.startLine ?? 1);
    let endLine = Math.max(startLine, opts.endLine ?? totalLines);
    if (opts.maxLines != null) endLine = Math.min(endLine, startLine + Math.max(0, opts.maxLines - 1));
    endLine = Math.min(endLine, totalLines);

    const lines: types.files.ReadAnchorLine[] = [];
    for (let i = startLine; i <= endLine; i++) {
        lines.push(ctx.fns.files.formatHashline({ line: i, text: all[i - 1] ?? "" }));
    }

    // Don't return huge content blobs — return only the slice metadata
    const contentTooLarge = content.length > MAX_FILE_SIZE;

    return {
        path: opts.path,
        content: contentTooLarge ? "" : content,
        lines,
        text: lines.map(x => `${x.anchor}|${x.text}`).join("\n"),
        truncated: startLine !== 1 || endLine !== totalLines || contentTooLarge,
        startLine,
        endLine,
        totalLines,
    };
}