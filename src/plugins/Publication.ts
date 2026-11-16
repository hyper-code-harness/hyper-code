/** A previewed or applied first publication of a plugin, produced by plugins.publish. */
export type Publication = {
    name: string;
    /** Version being published, X.Y.Z, and its tag vX.Y.Z. */
    version: string;
    tag: string;
    /** Repository in canonical form (plugins.repoUrl) — what the lock and a listing entry record. */
    repo: string;
    /** The address git pushes to. */
    url: string;
    /** Branch that is pushed with the tag. */
    branch: string;
    /** Commit the tag points at; in a preview the current HEAD (confirming may add one "Release" commit on top). */
    commit: string;
    /** State of the target repository as seen by the preview: `empty` — ready; `missing` — will be created on confirm (createRepo, on GitHub or a hyper-git server). */
    remote: 'empty' | 'missing';
    /** Repository that confirming creates; absent when the repository exists. On GitHub: owner/repo with its visibility.
     *  On a hyper-git server: the repository id with `server`, its host (no visibility — the network decides who reads). */
    creates?: { repo: string; visibility?: 'public' | 'private'; server?: string };
    /** What confirming changes in package.json before tagging (version, repository). Empty when nothing changes. */
    packageChanges: string[];
    /** Files of the plugin that are published. */
    files: string[];
    /** Result of the plugin's own tests. */
    tests: { ran: boolean; output: string };
    /** The listing entry for this plugin: what goes to `plugins/<name>.json` of a listing repository. */
    entry: { name: string; label: string; icon?: string; description: string; source: string; publishedBy?: string };
    /** Present when no repository was given and the address came from plugins.home: the network's git server, the owner
     *  the repository goes under, who the server sees this Hyper as, who is recorded as the publisher, and anything
     *  worth knowing (e.g. published as a person, not as a server of its own). */
    home?: { server: string; owner: string; identity?: { kind: 'server' | 'person'; id: string }; publishedBy?: string; notes: string[] };
    /** What happens (or happened) with the listing repository given in `listing`. */
    listing: {
        /** `not-requested` — no listing given, add `entry` yourself; `will-add` — preview; `added` — committed and pushed;
         *  `already-listed` — the entry was there; `push-refused` — the listing did not take it (no rights, the
         *  server's catalog rule, or it kept changing): the plugin is published, register it later with plugins.addToListing. */
        status: 'not-requested' | 'will-add' | 'added' | 'already-listed' | 'push-refused';
        repo?: string;
        commit?: string;
        detail?: string;
    };
    /** Where the clone is after the publication: at the released tag (like an install) or still on its branch. */
    at?: 'tag' | 'branch';
    /** Binds name, repository, version, commit and content; confirm must repeat it. */
    digest: string;
    status: 'preview' | 'published';
};
