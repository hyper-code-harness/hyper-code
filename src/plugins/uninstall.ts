/**
 * Removes a git-cloned plugin from USER_PLUGINS, after a preview
 *
 * Use to uninstall a plugin that plugins.install cloned. The first call previews (files that go away, uncommitted
 * files and unpushed commits) and refuses when another installed plugin requires it; repeating with confirmed:true
 * and the digest deletes the clone, drops it from the lock and remounts. A clone with local work also needs
 * force:true — the work is gone after that.
 * @param opts.name Installed plugin name.
 * @param opts.force Delete the clone even though it has uncommitted or unpushed work. @default false
 * @param opts.confirmed Apply the previewed removal. @default false
 * @param opts.expectedDigest Digest of the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name. */
    name: string;
    /** Delete the clone even though it has uncommitted or unpushed work. @default false */
    force?: boolean;
    /** Apply the previewed removal. @default false */
    confirmed?: boolean;
    /** Digest of the preview being confirmed. */
    expectedDigest?: string;
}): Promise<types.plugins.GitChange> {
    return await ctx.fns.plugins.gitInstall({
        operation: 'remove',
        name: opts.name,
        ...(opts.force ? { force: true } : {}),
        ...(opts.confirmed ? { confirmed: true, expectedDigest: opts.expectedDigest ?? '' } : {}),
    });
}
