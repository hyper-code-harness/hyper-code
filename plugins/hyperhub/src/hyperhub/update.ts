/**
 * Previews or approves replacement of an unmodified managed plugin at a pinned commit
 *
 * Returns a destination-bound review digest and file changes. Activation requires explicit human approval and matching expectedDigest. Refuses local drift and legacy provenance without contentDigest. Loader errors are reported without pretending runtime effects were undone.
 * @param opts.baseUrl Exact registry origin matching installed provenance.
 * @param opts.repo Exact repository matching installed provenance.
 * @param opts.name Installed lowercase unscoped plugin name.
 * @param opts.commit Exact immutable target commit; rollback requires saved previous commit.
 * @param opts.confirmed True only after explicit human approval. @default false
 * @param opts.expectedDigest Digest of the reviewed preview, required for activation.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact registry origin matching installed provenance. */
        baseUrl: string;
        /** Exact repository matching installed provenance. */
        repo: string;
        /** Installed lowercase unscoped plugin name. */
        name: string;
        /** Exact immutable target commit; rollback requires saved previous commit. */
        commit: string;
        /** True only after explicit human approval. @default false */
        confirmed?: boolean;
        /** Digest of the reviewed preview, required for activation. */
        expectedDigest?: string;
    },
): ReturnType<typeof ctx.fns.hyperhub.lifecycle> {
    return await ctx.fns.hyperhub.lifecycle({...opts,operation:'update'});
}
