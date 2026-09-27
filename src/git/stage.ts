/**
 * Stages paths with git add, locally or on the workspace SSH host.
 *
 * @param opts.paths Paths to stage, relative to the repository working directory.
 * @param opts.host SSH host alias, or "local"; omitted means the agent workspace (remote when it has a host).
 * @param opts.dir Repository working directory; defaults to the workspace directory.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Paths to stage. */ paths: string[]; /** SSH host alias, or "local"; omitted means the agent workspace. */ host?: string; /** Git working directory. */ dir?: string }) {
    const paths = opts.paths;
    if (!Array.isArray(paths) || paths.length === 0) throw new Error("paths required");
    return await ctx.fns.git.run({ args: ["add", "--", ...paths], dir: opts.dir, host: opts.host });
}
