/**
 * Creates a git commit, locally or on the workspace SSH host.
 *
 * @param opts.message Commit message.
 * @param opts.host SSH host alias, or "local"; omitted means the agent workspace (remote when it has a host).
 * @param opts.dir Repository working directory; defaults to the workspace directory.
 * @param opts.allowEmpty Allow a commit with no changes. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Commit message. */ message: string; /** SSH host alias, or "local"; omitted means the agent workspace. */ host?: string; /** Git working directory. */ dir?: string; /** Whether an empty commit is allowed. */ allowEmpty?: boolean }) {
    const message = opts.message;
    if (!message?.trim()) throw new Error("commit message required");
    const args = ["commit", "-m", message];
    if (opts.allowEmpty) args.push("--allow-empty");
    return await ctx.fns.git.run({ args, dir: opts.dir, host: opts.host });
}
