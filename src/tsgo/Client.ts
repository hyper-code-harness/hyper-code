// Live handle of the tsgo language server kept in ctx.state.tsgo.client.
export type Client = {
    /** tsgo process id. */
    pid: number;
    /** Project root the server was started in (holds tsconfig.json). */
    root: string;
    /** Resolved tsgo executable. */
    bin: string;
    /** Epoch ms when the process was spawned. */
    startedAt: number;
    /** Resolves once the LSP initialize handshake has completed. */
    ready: Promise<void>;
    /** False after the process exited or was stopped. */
    alive: boolean;
    /** Sends an LSP request and resolves with its result (rejects on error or timeout). */
    request(method: string, params: unknown, timeoutMs?: number): Promise<any>;
    /** Sends an LSP notification. */
    notify(method: string, params: unknown): void;
    /** Stops the process: LSP shutdown/exit, then kill. */
    close(): Promise<void>;
};
