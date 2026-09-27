/**
 * Pushes the current branch, locally or on the workspace SSH host.
 *
 * @param opts.host SSH host alias, or "local"; omitted means the agent workspace (remote when it has a host).
 * @param opts.dir Repository working directory; defaults to the workspace directory.
 * @param opts.remote Remote name. @default origin
 * @param opts.branch Branch to push; defaults to the current one.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** SSH host alias, or "local"; omitted means the agent workspace. */ host?: string; /** Git working directory. */ dir?: string; /** Remote repository name. */ remote?: string; /** Remote branch name. */ branch?: string } = {}) {
    const args = ["push"];
    if (opts.remote) args.push(opts.remote);
    if (opts.branch) args.push(opts.branch);
    return await ctx.fns.git.run({ args, dir: opts.dir, host: opts.host });
}
