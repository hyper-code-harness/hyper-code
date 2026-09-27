/**
 * Stages paths, commits them and optionally pushes, locally or on the workspace SSH host.
 *
 * @param opts.paths Paths to stage, relative to the repository working directory.
 * @param opts.message Commit message.
 * @param opts.host SSH host alias, or "local"; omitted means the agent workspace (remote when it has a host).
 * @param opts.dir Repository working directory; defaults to the workspace directory.
 * @param opts.push Push after committing. @default true
 * @param opts.allowEmpty Allow a commit with no changes. @default false
 * @param opts.remote Remote name. @default origin
 * @param opts.branch Branch to push; defaults to the current one.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: { /** Paths to stage. */ paths: string[]; /** Commit message. */ message: string; /** SSH host alias, or "local"; omitted means the agent workspace. */ host?: string; /** Git working directory. */ dir?: string; /** Whether to push after committing. */ push?: boolean; /** Whether an empty commit is allowed. */ allowEmpty?: boolean; /** Remote repository name. */ remote?: string; /** Remote branch name. */ branch?: string },
) {
    const staged = await ctx.fns.git.stage({ paths: opts.paths, dir: opts.dir, host: opts.host });
    const committed = await ctx.fns.git.commit({ message: opts.message, dir: opts.dir, host: opts.host, allowEmpty: opts.allowEmpty });
    const pushed = opts.push === false ? null : await ctx.fns.git.push({ dir: opts.dir, host: opts.host, remote: opts.remote, branch: opts.branch });
    return { staged, committed, pushed };
}
