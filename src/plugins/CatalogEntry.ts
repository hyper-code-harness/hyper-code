/** A listing plugin with its state on this machine, as returned by plugins.catalog. */
export type CatalogEntry = types.plugins.ListingEntry & {
    /** Newest `vX.Y.Z` release; absent when the repository has none or could not be reached. */
    latest?: string;
    /** Installed version of the git clone in USER_PLUGINS, from its package.json. */
    installed?: string;
    /** Release tag the clone was installed at (plugin lock); set exactly when the plugin is installed from the listing. */
    tag?: string;
    /** A newer release than the installed one exists. */
    update: boolean;
    /** Mounted from somewhere else (an official plugin or a folder in USER_PLUGINS not installed from the listing) — installing would collide. */
    providedBy?: string;
    /** Plugins it needs (procs.requires of the installed copy); unknown until installed or previewed. */
    requires?: string[];
    /** Git state of the installed clone (badges: release, edited, branch +N, fork). */
    git?: types.plugins.CloneGit;
    /** Why the latest release is unknown. */
    error?: string;
};
