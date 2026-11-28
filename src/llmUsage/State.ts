import type { AsyncLocalStorage } from "node:async_hooks";

/** Per-context accounting state. The identity sets prevent forged RPC ledger writes. */
export type State = {
    storage?: AsyncLocalStorage<types.llmUsage.Scope>;
    scopes: WeakSet<types.llmUsage.Scope>;
    attempts: WeakSet<types.llmUsage.Attempt>;
    writes: number;
    enabledUntil: number;
    enabled: boolean;
    checking: boolean;
    enabledCheck?: Promise<boolean>;
};
