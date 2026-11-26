/** One AGENTS.md or CLAUDE.md candidate within a labelled instruction directory scope. */
export type InstructionSource = {
    /** Absolute lexical candidate path; preserved even when it names a symlink. */
    path: string;
    /** Global ~/.hyper instructions and project instructions have separate byte budgets. */
    scope: "global" | "project";
    /** Directory this instruction applies to; duplicate detection never crosses this label. */
    directory: string;
    /** Included, trimmed UTF-8 text; empty for omitted and duplicate sources. */
    content: string;
    /** Whether text was included, duplicated within this directory, omitted, or budget-truncated. */
    status: "loaded" | "duplicate" | "omitted" | "truncated";
    /** Earlier candidate path with identical trimmed text or canonical identity in this directory. */
    duplicateOf?: string;
    /** Number of UTF-8 bytes included in content, not the source file size. */
    bytes: number;
};
