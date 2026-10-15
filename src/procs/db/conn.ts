// Lazily open the Postgres pool (Bun.SQL) and cache it in this module's own
// state — ctx.state.procs.db.sql, like every module's state. Because state is
// per-ctx, a forked test env (env.fork) gets its OWN isolated pool.
//
// hyper-code2: under NODE_ENV=test the pool is capped at ONE connection; the database is the test process's
// copy of the migrated template (src/_testDb.entry.ts), reset between tests. Test pools register on globalThis
// for the harness to close (idle pooled connections would otherwise exhaust max_connections across the suite).
import { SQL } from "bun";

/**
 * Get this context's Postgres pool or the connection bound by db.transaction.
 * Closed transaction scopes throw instead of silently writing outside the transaction.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<SQL> {
    const st = ((ctx.state.procs ??= {} as any).db ??= {});
    const scope = st.transactionStorage?.getStore();
    if (scope) {
        if (!scope.active) throw new Error("Database transaction scope is closed");
        return scope.connection;
    }
    if (st.sql) return st.sql;
    const url = ctx.fns.procs.db.url();
    st.url = url;
    const isTest = ctx.env.NODE_ENV === "test";
    // prepare:false — Bun 1.3.14 loses queued queries under concurrent
    // parameterized queries on a saturated pool (server idles in ClientRead,
    // client promises never resolve). The simple protocol has no such bug.
    const sql = new SQL(url, { max: isTest ? 1 : Number(ctx.env.PG_POOL_MAX) || 8, prepare: false });
    if (isTest) (((globalThis as any).__hyperTestPools ??= new Set()) as Set<SQL>).add(sql);
    st.sql = sql;
    return sql;
}
