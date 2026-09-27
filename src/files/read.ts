/**
 * Reads a workspace file, or a remote file over SSH, as UTF-8 text.
 *
 * Local files are capped at 10 MB. With host the file is fetched through remote.readFile.
 * @param opts.host Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means the local workspace.
 * @param opts.path Workspace-relative or absolute path; with host a remote path relative to the remote home.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means local. */ host?: string; /** Workspace-relative path, or remote path when host is set. */ path: string }): Promise<string> {
    if (opts.host) return await ctx.fns.remote.readFile({ host: opts.host, path: opts.path });
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
    const abs = ctx.fns.files.resolveSafe({ path: opts.path });
    const stat = await Bun.file(abs).stat();

    if (stat && stat.size > MAX_FILE_SIZE) {
        throw new Error(`File too large: ${opts.path} (${(stat.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_FILE_SIZE / 1024 / 1024} MB)`);
    }

    return await Bun.file(abs).text();
}
