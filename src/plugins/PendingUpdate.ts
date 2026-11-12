/** An update available for an installed plugin clone, as found by plugins.checkUpdates. */
export type PendingUpdate = {
    name: string;
    /** `tag`: a newer release exists; `branch`: the followed branch has new commits upstream. */
    mode: 'tag' | 'branch';
    /** What is installed: the release tag, or the branch name. */
    from: string;
    /** What is available: the newest release tag, or `<branch> +N`. */
    to: string;
    /** Branch mode: how many commits upstream is ahead. */
    newCommits?: number;
    /** Commit the clone was at when this was found; the entry stops counting once the clone has moved. */
    installedCommit: string;
};
