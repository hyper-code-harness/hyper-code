/** A listing plugin with its state on this machine, as returned by plugins.catalog. */
export type CatalogEntry = types.plugins.ListingEntry & {
    /** Newest `vX.Y.Z` release; absent when the repository has none or could not be reached. */
    latest?: string;
    /** Installed version of the git clone in USER_PLUGINS, from its package.json. */
    installed?: string;
    /** Release tag the clone was installed at (plugin lock), in tag mode; `mode` is set exactly when the plugin is installed from the listing. */
    tag?: string;
    /** Ref kind of the installed clone: release tag, followed branch (dev mode) or pinned commit. */
    mode?: 'tag' | 'branch' | 'commit';
    /** Branch the installed clone follows (branch mode). */
    branch?: string;
    /** Commit the lock pins the installed clone to. */
    commit?: string;
    /** Branch mode: commits the branch has upstream that the clone has not (plugins.branchUpdates). */
    newCommits?: number;
    /** A newer release than the installed one exists, or (branch mode) the branch moved upstream. */
    update: boolean;
    /** Mounted from somewhere else (an official plugin or a folder in USER_PLUGINS not installed from the listing) — installing would collide. */
    providedBy?: string;
    /** Plugins it needs (procs.requires of the installed copy), `name` or `name range` such as `mermaid ^1.0`; unknown until installed or previewed. */
    requires?: string[];
    /** Git state of the installed clone (badges: release, edited, branch +N, fork). */
    git?: types.plugins.CloneGit;
    /** Why the latest release is unknown. */
    error?: string;
};
