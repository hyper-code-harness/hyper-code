/** A repository cloned into staging and inspected, before anything is installed — what skills.stage returns. */
export type Staged = {
    /** Staging folder to remove when done; the clone is in `dir`. */
    stage: string;
    /** The checked-out clone. */
    dir: string;
    /** Repository in canonical form. */
    repo: string;
    /** Repository owner, or the folder name for a local repository. */
    owner: string;
    tag?: string;
    branch?: string;
    /** Commit the clone is checked out at. */
    commit: string;
    /** Skills found and checked by skills.inspectPack. */
    inspected: {
        name: string | null;
        version: string | null;
        found: "plugin.json" | "marketplace.json" | "scan";
        skills: Array<{ name: string; path: string; description: string; modelInvocable: boolean; userInvocable: boolean; bodyChars: number; files: number; bytes: number; executables: string[]; diagnostics: string[]; hash: string }>;
        skipped: Array<{ path: string; reason: string }>;
        digest: string;
    };
};
