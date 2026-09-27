import { stat } from "node:fs/promises";

// File/dir metadata, or null if missing. All paths relative to workspace root.
/**
 * Returns metadata for a workspace path, or for a path on an SSH host; null when missing.
 *
 * @param opts.path Workspace-relative or absolute path; with host a remote path.
 * @param opts.host SSH host alias (see remote.servers); omitted means local.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** SSH host alias (see remote.servers); omitted means local. */ host?: string; /** Workspace-relative path. */ path: string }): Promise<{
    isDir: boolean; size: number; mtime: number;
} | null> {
    if (opts.host) return await ctx.fns.remote.stat({ host: opts.host, path: opts.path });
    const abs = ctx.fns.files.resolveSafe({ path: opts.path });
    const s = await stat(abs).catch(() => null);
    if (!s) return null;
    return { isDir: s.isDirectory(), size: s.size, mtime: s.mtimeMs };
}
