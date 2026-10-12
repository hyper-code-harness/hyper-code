import { test, expect } from "bun:test";
import { SQL } from "bun";
import { testCtx } from "../../$test";

const ctx = await testCtx();
function gate() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}

test("transaction: commit returns value; select/run/insert/exec share transaction", async () => {
    await ctx.fns.procs.db.exec({ sql: "CREATE TABLE tx_items (id SERIAL PRIMARY KEY, value TEXT)" });
    const result = await ctx.fns.procs.db.transaction({ fn: async () => {
        await ctx.fns.procs.db.exec({ sql: "CREATE TABLE tx_ddl (value TEXT)" });
        await ctx.fns.procs.db.insert({ into: "tx_items", values: { value: "committed" } });
        await ctx.fns.procs.db.run({ sql: "UPDATE tx_items SET value = ?", params: ["changed"] });
        expect(await ctx.fns.procs.db.select({ sql: "SELECT value FROM tx_items" })).toEqual([{ value: "changed" }]);
        return { committed: true };
    } });
    expect(result).toEqual({ committed: true });
    expect(await ctx.fns.procs.db.select({ sql: "SELECT value FROM tx_items" })).toEqual([{ value: "changed" }]);
});

test("transaction: throw rolls back multiple operations and DDL", async () => {
    await expect(ctx.fns.procs.db.transaction({ fn: async () => {
        await ctx.fns.procs.db.insert({ into: "tx_items", values: { value: "rolled back" } });
        await ctx.fns.procs.db.run({ sql: "DELETE FROM tx_items WHERE value = ?", params: ["changed"] });
        await ctx.fns.procs.db.exec({ sql: "CREATE TABLE tx_rollback_ddl (value TEXT)" });
        throw new Error("rollback sentinel");
    } })).rejects.toThrow("rollback sentinel");
    expect(await ctx.fns.procs.db.select({ sql: "SELECT value FROM tx_items" })).toEqual([{ value: "changed" }]);
    expect(await ctx.fns.procs.db.select({ sql: "SELECT to_regclass('pg_temp.tx_rollback_ddl') AS name" })).toEqual([{ name: null }]);
});

test("transaction: nested transaction rejects and rolls back outer", async () => {
    await expect(ctx.fns.procs.db.transaction({ fn: async () => {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM tx_items" });
        await ctx.fns.procs.db.transaction({ fn: async () => undefined });
    } })).rejects.toThrow("Nested database transactions");
    expect(await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int AS n FROM tx_items" })).toEqual([{ n: 1 }]);
});

test("transaction: escaped async callbacks reject after commit and rollback", async () => {
    for (const rollback of [false, true]) {
        const released = gate();
        let escaped!: Promise<string>;
        const work = ctx.fns.procs.db.transaction({ fn: async () => {
            escaped = (async () => {
                await released.promise;
                try { await ctx.fns.procs.db.select({ sql: "SELECT 1" }); return "unexpected success"; }
                catch (error) { return (error as Error).message; }
            })();
            if (rollback) throw new Error("rollback escaped");
        } });
        if (rollback) await expect(work).rejects.toThrow("rollback escaped");
        else await work;
        released.resolve();
        expect(await escaped).toBe("Database transaction scope is closed");
    }
});

test("transaction: fork has independent binding and pool inside parent's transaction", async () => {
    const fork = ctx.fns.procs.env.fork({ mode: "test" });
    await ctx.fns.procs.db.transaction({ fn: async () => {
        const parent = await ctx.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" });
        await fork.fns.procs.db.transaction({ fn: async () => {
            const child = await fork.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" });
            expect(child[0].pid).not.toBe(parent[0].pid);
            expect(await ctx.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" })).toEqual(parent);
        } });
    } });
});

test("transaction: concurrent commit/rollback and outside query use separate connections", async () => {
    const parallel = ctx.fns.procs.env.fork({ mode: "test" });
    // Only this disposable test ctx gets a wider pool. All writes below are TEMP.
    const pool = new SQL(ctx.fns.procs.db.url({}), { max: 3, prepare: false });
    parallel.state.procs.db = { sql: pool };
    const enteredA = gate(), enteredB = gate(), release = gate();
    const pids: number[] = [];
    try {
        const a = parallel.fns.procs.db.transaction({ fn: async () => {
            const [{ pid }] = await parallel.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" });
            pids.push(pid);
            await parallel.fns.procs.db.exec({ sql: "CREATE TEMP TABLE tx_concurrent_a (v INT)" });
            await parallel.fns.procs.db.run({ sql: "INSERT INTO tx_concurrent_a VALUES (1)" });
            enteredA.resolve();
            await release.promise;
            expect(await parallel.fns.procs.db.select({ sql: "SELECT v FROM tx_concurrent_a" })).toEqual([{ v: 1 }]);
            return pid;
        } });
        const b = parallel.fns.procs.db.transaction({ fn: async () => {
            const [{ pid }] = await parallel.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" });
            pids.push(pid);
            await parallel.fns.procs.db.exec({ sql: "CREATE TEMP TABLE tx_concurrent_b (v INT)" });
            enteredB.resolve();
            await release.promise;
            expect(await parallel.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" })).toEqual([{ pid }]);
            throw new Error("concurrent rollback");
        } }).then(() => "unexpected success", (error: Error) => error.message);
        await Promise.all([enteredA.promise, enteredB.promise]);
        const [{ pid: outside }] = await parallel.fns.procs.db.select({ sql: "SELECT pg_backend_pid() AS pid" });
        expect(new Set([...pids, outside]).size).toBe(3);
        expect(await parallel.fns.procs.db.conn({})).toBe(pool);
        release.resolve();
        expect(pids).toContain(await a);
        expect(await b).toBe("concurrent rollback");
    } finally {
        release.resolve();
        await pool.close();
    }
});
