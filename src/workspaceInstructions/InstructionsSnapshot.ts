/** Bounded, read-only workspace instruction discovery result, ordered broad to specific. */
export type InstructionsSnapshot = {
    /** Absolute lexical workspace path; symlinks do not change the project boundary. */
    dir: string;
    /** SSH alias, or the empty string for a local workspace. */
    host: string;
    /** Nearest ancestor with a regular-file or directory .git marker, otherwise dir. */
    root: string;
    /** Found instruction sources, including explicit duplicate and budget omission records. */
    sources: types.workspaceInstructions.InstructionSource[];
    /** Bounded actionable diagnostics, never instruction contents or remote stderr. */
    warnings: string[];
};
