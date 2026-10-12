// ctx.state.procs.db — the live Bun.SQL pool and its url, cached per ctx. A
// forked world (env.fork) gets its own, so a test never shares the dev pool.
import type { SQL } from "bun";
import type { AsyncLocalStorage } from "node:async_hooks";
export type State = {
    sql?: SQL;
    url?: string;
    /** Per-context async binding; never replace the shared pool with a transaction. */
    transactionStorage?: AsyncLocalStorage<{ connection: SQL; active: boolean }>;
};
