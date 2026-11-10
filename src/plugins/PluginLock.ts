/**
 * ~/.hyper/plugins.lock.json: what each git-cloned plugin in USER_PLUGINS was installed from.
 *
 * The ref kind of an entry follows from its fields: `branch` set → the clone follows that branch (dev mode);
 * otherwise `tag` set → pinned to a release tag; neither → pinned to the exact `commit`. Lock files written before
 * branch and commit modes existed (always `tag`) read unchanged.
 */
export type PluginLock = {
    plugins: Record<string, {
        /** Listing source: `github:owner/repo`, `git+file:///…` or a git URL. */
        repo: string;
        /** Release tag the clone was installed or last updated at (tag mode). */
        tag?: string;
        /** Branch of origin the clone is checked out on and follows (branch mode). */
        branch?: string;
        /** Commit SHA the clone was put at — for a tag, what it pointed at then (a moved tag does not change it). */
        commit: string;
        /** Earlier refs (tag, branch or bare commit), oldest first; rollback returns to the last one. */
        previous: Array<{ tag?: string; branch?: string; commit: string }>;
    }>;
};
