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
    /** State of the target repository as seen by the preview: `empty` — ready; `missing` — will be created on confirm (GitHub, createRepo). */
    remote: 'empty' | 'missing';
    /** GitHub repository that confirming creates, with its visibility; absent when the repository exists. */
    creates?: { repo: string; visibility: 'public' | 'private' };
    /** What confirming changes in package.json before tagging (version, repository). Empty when nothing changes. */
    packageChanges: string[];
    /** Files of the plugin that are published. */
    files: string[];
    /** Result of the plugin's own tests. */
    tests: { ran: boolean; output: string };
    /** The listing entry for this plugin: what goes to `plugins/<name>.json` of a listing repository. */
    entry: { name: string; label: string; icon?: string; description: string; source: string };
    /** What happens (or happened) with the listing repository given in `listing`. */
    listing: {
        /** `not-requested` — no listing given, add `entry` yourself; `will-add` — preview; `added` — committed and pushed;
         *  `already-listed` — the entry was there; `push-refused` — no push rights: open a pull request with `entry`. */
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
