import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Writes text to a workspace file, or to a remote file over SSH, creating parent directories.
 *
 * @param opts.host Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means the local workspace.
 * @param opts.path Workspace-relative or absolute path; with host a remote path relative to the remote home.
 * @param opts.content Full file body written verbatim.
 * @param opts.expectedContent Remote only: expected current content; the write is refused if the remote file changed since it was read.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means local. */ host?: string; /** Workspace-relative path, or remote path when host is set. */ path: string; /** Content to write. */ content: string; /** Remote only: expected current content; the write is refused if the remote file changed since it was read. */ expectedContent?: string }): Promise<{ bytes: number }> {
    if (opts.host) return await ctx.fns.remote.writeFile({ host: opts.host, path: opts.path, content: opts.content, expectedContent: opts.expectedContent });
    const abs = ctx.fns.files.resolveSafe({ path: opts.path });
    await mkdir(dirname(abs), { recursive: true });
    const bytes = await Bun.write(abs, opts.content);
    return { bytes };
}
