/**
 * Removes a plugin installed in PLUGIN_HOST, after a preview
 *
 * Use to uninstall a plugin that plugins.install put there. The first call previews (files that go away) and refuses
 * when another installed plugin requires it; repeating with confirmed:true and the digest removes it and remounts.
 * The previous state stays in the host history, so plugins.bunInstall({ operation: "rollback" }) can bring it back.
 * @param opts.name Installed plugin name.
 * @param opts.confirmed Apply the previewed removal. @default false
 * @param opts.expectedDigest Digest of the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name. */
    name: string;
    /** Apply the previewed removal. @default false */
    confirmed?: boolean;
    /** Digest of the preview being confirmed. */
    expectedDigest?: string;
}): Promise<types.plugins.HostChange> {
    return await ctx.fns.plugins.bunInstall({
        operation: 'remove',
        name: opts.name,
        ...(opts.confirmed ? { confirmed: true, expectedDigest: opts.expectedDigest ?? '' } : {}),
    });
}
