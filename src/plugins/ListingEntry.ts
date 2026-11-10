/** One plugin of the listing index.json (format 2): identity, display metadata and where its releases live. */
export type ListingEntry = {
    /** Package and dependency name: lowercase, unscoped. */
    name: string;
    label: string;
    description: string;
    /** Phosphor icon class, `ph-*`. */
    icon?: string;
    /** GitHub repository, `github:owner/repo`; releases are its `vX.Y.Z` tags. */
    source: string;
    /** Address of the listing this entry came from. */
    listing: string;
};
