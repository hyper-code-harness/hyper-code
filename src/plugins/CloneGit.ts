/** Git state of a plugin clone in USER_PLUGINS, as plugins.installed reports it. */
export type CloneGit = {
    /** Release tag recorded in the plugin lock (plugins.install); absent for a clone installed by hand. */
    lockedTag?: string;
    /** Branch the lock follows (branch mode). */
    lockedBranch?: string;
    /** Ref kind of the lock entry: release tag, followed branch or pinned commit; absent for a clone installed by hand. */
    mode?: 'tag' | 'branch' | 'commit';
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
    /** Branch mode: commits origin/<lockedBranch> has that HEAD lacks (plugins.branchUpdates), when it was asked. */
    newCommits?: number;
    /** The repository has no remote at all: a private plugin kept as a local git repository (plugins.gitInit), never published. */
    local?: boolean;
    /** origin is not the repository the plugin was installed from (lock repo) — a fork. */
    fork: boolean;
};
