/** A listing plugin with its state on this machine, as returned by plugins.catalog. */
export type CatalogEntry = types.plugins.ListingEntry & {
    /** Newest `vX.Y.Z` release; absent when the repository has none or could not be reached. */
    latest?: string;
    /** Installed version in PLUGIN_HOST, from the plugin's package.json. */
    installed?: string;
    /** bun spec the host depends on, e.g. github:owner/repo#v1.2.0. */
    spec?: string;
    /** A newer release than the installed one exists. */
    update: boolean;
    /** Mounted from somewhere else (an official or USER_PLUGINS copy) — installing would collide. */
    providedBy?: string;
    /** Plugins it needs (procs.requires of the installed copy); unknown until installed or previewed. */
    requires?: string[];
    /** Why the latest release is unknown. */
    error?: string;
};
