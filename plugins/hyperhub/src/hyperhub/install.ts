/**
 * Previews or activates a structurally validated plugin at an immutable registry commit
 *
 * Previews or activates a structurally validated plugin at an immutable registry commit.

Stages outside USER_PLUGINS without running code. Activation requires explicit human approval and the digest from preview; trusted plugin code may auto-load immediately. No sandbox, dependencies or namespace overrides. All lifecycle operations share a lock.
 * @param opts.baseUrl Credential-free HTTPS Hyper-git origin.
 * @param opts.repo Repository identifier.
 * @param opts.name Exact unscoped plugin basename.
 * @param opts.commit Exact 40 or 64 hexadecimal commit.
 * @param opts.confirmed True only after explicit human approval to execute this plugin. @default false
 * @param opts.expectedDigest Reviewed preview digest, required for activation.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Credential-free HTTPS Hyper-git origin. */
        baseUrl: string;
        /** Repository identifier. */
        repo: string;
        /** Exact unscoped plugin basename. */
        name: string;
        /** Exact 40 or 64 hexadecimal commit. */
        commit: string;
        /** True only after explicit human approval to execute this plugin. @default false */
        confirmed?: boolean;
        /** Reviewed preview digest, required for activation. */
        expectedDigest?: string;
    },
): ReturnType<typeof ctx.fns.hyperhub.lifecycle> {
    return await ctx.fns.hyperhub.lifecycle({...opts,operation:'install'});
}
