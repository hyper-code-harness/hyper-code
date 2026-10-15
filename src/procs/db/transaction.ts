/**
 * Run framework database operations atomically on one reserved Postgres connection
 *
 * Use a callback to group procs.db select, run, insert and exec calls in one transaction. AsyncLocalStorage binds only this context and async chain. The callback must await all database work. Nested transactions are rejected. A resolved promise means COMMIT finished; run external side effects only afterwards. Async callbacks that reach conn after the scope closes throw rather than falling back to the pool.
 * @param opts.fn Awaited transaction body. Await every database operation and return the desired result; throwing rolls back all statements.
 */
export default async function <T>(
    ctx: Context,
    session: Session | null,
    opts: {
        /** Awaited transaction body. Await every database operation and return the desired result; throwing rolls back all statements. */
        fn: () => Promise<T>;
    },
): Promise<T> {
    const { AsyncLocalStorage } = await import("node:async_hooks");
    const st = ((ctx.state.procs ??= {} as any).db ??= {});
    const storage = (st.transactionStorage ??= new AsyncLocalStorage<{ connection: Awaited<ReturnType<typeof ctx.fns.procs.db.conn>>; active: boolean }>());
    const existing = storage.getStore();
    if (existing) throw new Error(existing.active ? "Nested database transactions are not supported" : "Database transaction scope is closed");
    const pool = await ctx.fns.procs.db.conn({});
    // Bun's SQL.begin runs its callback outside the caller's async context: every
    // AsyncLocalStorage store (another ctx's open transaction, tracing, …) would be
    // lost inside. Restore the caller's context first.
    const resume = AsyncLocalStorage.snapshot();
    return await pool.begin((connection) => resume(async () => {
        const scope = { connection: connection as typeof pool, active: true };
        return await storage.run(scope, async () => {
            try { return await opts.fn(); }
            finally { scope.active = false; }
        });
    }));
}
