/** ~/.hyper/plugins.lock.json: what each git-cloned plugin in USER_PLUGINS was installed from. */
export type PluginLock = {
    plugins: Record<string, {
        /** Listing source: `github:owner/repo`, `git+file:///…` or a git URL. */
        repo: string;
        /** Release tag the clone was installed or last updated at. */
        tag: string;
        /** Commit SHA the tag pointed at then — a moved tag does not change it. */
        commit: string;
        /** Earlier tag/commit pairs, oldest first; rollback returns to the last one. */
        previous: Array<{ tag: string; commit: string }>;
    }>;
};
