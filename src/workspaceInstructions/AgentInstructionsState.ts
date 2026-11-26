/** Durable metadata for the current workspace instruction selection; never stores file bodies. */
export type AgentInstructionsState = {
    /** JSON identity of host and workspace directory. */
    key: string;
    /** Up to 64 successfully accessed files whose nested instructions are relevant. */
    paths: string[];
    /** True when older nested paths were dropped to bound discovery. */
    pathsLimited?: boolean;
    /** Snapshot digest last delivered to the model. */
    hash?: string;
    /** Whether a snapshot has ever been delivered, including before a compaction. */
    delivered?: boolean;
    /** Time the selection was last checked, in milliseconds since epoch. */
    checkedAt?: number;
    /** Project root selected by the loader. */
    root?: string;
    /** Last delivered sources, without their instruction content. */
    sources?: Array<{ path: string; directory: string; scope: string; status: string; bytes: number; duplicateOf?: string }>;
    /** Actionable loading, truncation, or path-limit warnings. */
    warnings?: string[];
};
