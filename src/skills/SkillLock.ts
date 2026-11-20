/**
 * ~/.hyper/skills.lock.json: what each installed skill pack in ~/.hyper/skills was installed from.
 *
 * Separate from the plugin lock on purpose: a pack is text an agent reads, a plugin is code the runtime loads.
 */
export type SkillLock = {
    packs: Record<string, {
        /** Repository in canonical form (plugins.repoUrl): `github:owner/repo`, an https or ssh address, `git+file:///path`. */
        repo: string;
        /** Where the pack comes from: a publisher's own repository, a repository pinned by an official catalogue, or anything else. */
        trust: "official" | "listed" | "community";
        /** The model may start skills of this pack by itself; false leaves them reachable by /name only. */
        model: boolean;
        /** Release tag the clone was put at, when one was used. */
        tag?: string;
        /** Branch the commit was taken from, when no tag was used. */
        branch?: string;
        /** Commit the clone is checked out at. */
        commit: string;
        /** Earlier refs, oldest first. */
        previous: Array<{ tag?: string; branch?: string; commit: string }>;
        /** Skill names or globs the pack was narrowed to; absent means what the repository's own manifest lists. */
        select?: string[];
        /** Installed skills by name: folder inside the clone and content hash (the `computedHash` algorithm of `npx skills`). */
        skills: Record<string, { path: string; hash: string }>;
        /** When the current commit was installed, epoch milliseconds. */
        installedAt: number;
    }>;
};
