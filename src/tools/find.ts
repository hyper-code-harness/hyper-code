// Find files by glob. Declared by $tool_find.md; callable by hand as
// ctx.fns.tools.find({ pattern: "**/*.test.ts" }).
/**
 * Implements glob file search in the local workspace or on a remote SSH host.
 *
 * @param opts.host Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means the local workspace.
 * @param opts.pattern Glob such as *.test.ts; without a slash it matches at any depth.
 * @param opts.path Directory to search; workspace-relative locally, relative to the remote home with host.
 * @param opts.limit Maximum number of paths. @default 200 @minimum 1
 * @param opts.noIgnore Include files ignored by .gitignore. @default false
 * @param opts.hidden Include dotfiles and dot-directories. @default false
 * @param opts.timeout Seconds before the walk is cut short.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Remote SSH host alias from ~/.ssh/config (see remote.servers); omitted means local. */ host?: string; /** Glob or search pattern. */ pattern: string; /** Workspace-relative path. */ path?: string; /** Maximum number of results. */ limit?: number; /** Whether to include ignored files. */ noIgnore?: boolean; /** Whether to include hidden paths. */ hidden?: boolean; /** Timeout in seconds. */ timeout?: number },
): Promise<string> {
    const limit = Math.max(1, opts.limit ?? 200);
    const rows = opts.host
        ? (await ctx.fns.remote.find({ ...opts, host: opts.host, limit })).paths
        : await ctx.fns.files.find({ ...opts, limit });
    const notes: string[] = [];
    if (!rows.length) notes.push("(no files matched)");
    if (rows.length >= limit) notes.push(`NOTE: stopped at the limit of ${limit} paths — narrow the pattern or raise limit.`);
    return [rows.join("\n"), ...notes].filter(Boolean).join(rows.length && notes.length ? "\n\n" : "");
}
