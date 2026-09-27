// ctx.state.tsgo — the out-of-process TypeScript 7 (tsgo) language server used
// to typecheck eval code without blocking the event loop.
export type State = {
    /** Running client, if any. */
    client?: types.tsgo.Client;
    /** In-flight start, shared by concurrent callers. */
    starting?: Promise<types.tsgo.Client | null>;
    /** Serializes checks: they share one virtual document. */
    queue?: Promise<unknown>;
    /** Version counter of the virtual eval document; 0 means not opened yet. */
    docVersion?: number;
    /** Changed file paths waiting to be sent as workspace/didChangeWatchedFiles. */
    pendingChanges?: Map<string, 1 | 2 | 3>;
    /** Active fs.watch handles feeding pendingChanges. */
    watchers?: Array<{ close(): void }>;
    /** Recent crash timestamps; too many in a minute disables restarts. */
    crashes?: number[];
    /** Last start or protocol error. */
    lastError?: string;
    /** Check counters for status. */
    stats?: { checks: number; totalMs: number; maxMs: number; timeouts: number; fallbacks: number };
};
