/** Git state of a plugin clone in USER_PLUGINS, as plugins.installed reports it. */
export type CloneGit = {
    /** Release tag recorded in the plugin lock (plugins.install); absent for a clone installed by hand. */
    lockedTag?: string;
    /** vX.Y.Z tag at HEAD, if any. */
    tag?: string;
    commit: string;
    /** Current branch; absent on a detached HEAD (a clean install sits detached at its tag). */
    branch?: string;
    /** Nearest release tag reachable from HEAD. */
    baseTag?: string;
    /** Commits since baseTag (0 when HEAD is at it). */
    sinceTag: number;
    /** Uncommitted paths. */
    dirty: string[];
    /** Commits on no remote branch and under no tag. */
    unpushed: string[];
    /** Commits ahead of / behind the branch upstream, or of the base tag when detached. */
    ahead: number;
    behind: number;
    origin?: string;
    upstream?: string;
    /** origin is not the repository the plugin was installed from (lock repo) — a fork. */
    fork: boolean;
};
