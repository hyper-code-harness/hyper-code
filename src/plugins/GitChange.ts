/** A previewed or applied change of a plugin git clone in USER_PLUGINS, produced by plugins.gitInstall. */
export type GitChange = {
    operation: 'install' | 'update' | 'remove' | 'rollback';
    name: string;
    /** Repository as the lock records it: `github:owner/repo`, `git+file:///…` or a git URL. */
    repo?: string;
    /** Release tag the clone is (or will be) checked out at; absent for remove. */
    tag?: string;
    /** Commit SHA of that tag — what the digest binds. */
    commit?: string;
    /** Tree SHA of that commit. */
    tree?: string;
    /** The tag and commit the clone is at before the change (update, rollback, remove). */
    from?: { tag?: string; commit: string };
    plugin?: types.plugins.PackageInspection;
    /** Files compared with the current clone. */
    added: string[];
    removed: string[];
    changed: string[];
    /** `git diff --stat` between the current and the new commit (update, rollback). */
    diffStat?: string;
    /** Plugins cloned in the same step because the plugin requires them (opts.with). */
    companions?: Array<{ name: string; repo: string; tag: string; commit: string; version?: string; namespaces: string[] }>;
    /** npm packages the clone's node_modules has after the change that it did not have before. */
    newPackages: string[];
    /** bun's note about install scripts it refused to run, if any. */
    blockedScripts?: string;
    /** Uncommitted paths in the current clone (`git status --porcelain`), for remove. */
    dirty?: string[];
    /** Commits of the current clone that no remote has (`<sha> <subject>`), for remove. */
    unpushed?: string[];
    /** Remove would lose local work: confirming needs force:true. */
    needsForce?: boolean;
    /** Binds operation, repo, commit, tree and content of every clone; confirm must repeat it. */
    digest: string;
    status: 'preview' | 'applied' | 'applied-load-failed';
    loadError?: string;
};
