/** One plugin of the listing index.json (format 2): identity, display metadata and where its releases live. */
export type ListingEntry = {
    /** Package and dependency name: lowercase, unscoped. */
    name: string;
    label: string;
    description: string;
    /** Phosphor icon class, `ph-*`. */
    icon?: string;
    /** The plugin's git repository in canonical form (plugins.repoUrl): `github:owner/repo`, an https or ssh address on any git server, or `git+file:///path` in a listing on this machine. Releases are its `vX.Y.Z` tags. */
    source: string;
    /** Who published it, as the listing records it: a server of the network (spiffe://…) or a person's email. Absent in listings that do not say. */
    publishedBy?: string;
    /** Address of the listing this entry came from. */
    listing: string;
};
