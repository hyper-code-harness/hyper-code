import { test, expect } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();

// A fork whose unqualified tables (_migrations, a, b) land in a schema of its own, dropped by the reset after the test.
let n = 0;
async function scratch() {
    const schema = `migrate_test_${process.pid}_${++n}`;
    await ctx.fns.procs.db.exec({ sql: `CREATE SCHEMA ${schema}` });
    const c = ctx.fns.procs.env.fork({ mode: "test" });
    const { SQL } = await import("bun");
    const sql = new SQL(ctx.fns.procs.db.url({}), { max: 1, prepare: false, connection: { search_path: schema } });
    (((globalThis as any).__hyperTestPools ??= new Set()) as Set<unknown>).add(sql);
    c.state.procs.db = { sql } as any;
    return c;
}

test("migrate: up (in id order, idempotent) + status + down", async () => {
    // Own world: testCtx already applied the app's real migrations to the shared test database, so the fork
    // gets its own connection, an empty schema first on its search_path and its own migration list
    // (the state object is replaced wholesale so the parent's list is untouched).
    const c = await scratch();
    (c.state.procs as any).migrate = {
        list: [
            { id: "001_a", up: (x: Context) => x.fns.procs.db.exec({ sql: "CREATE TABLE a (x INTEGER)" }), down: (x: Context) => x.fns.procs.db.exec({ sql: "DROP TABLE a" }) },
            { id: "002_b", up: (x: Context) => x.fns.procs.db.exec({ sql: "CREATE TABLE b (y INTEGER)" }) },
        ],
    };
    expect((await c.fns.procs.migrate.up({})).applied).toEqual(["001_a", "002_b"]);
    expect((await c.fns.procs.migrate.up({})).applied).toEqual([]); // idempotent
    expect((await c.fns.procs.migrate.status({})).every((m: any) => m.applied)).toBe(true);

    expect((await c.fns.procs.migrate.down({})).rolledBack).toEqual(["002_b"]); // last only
    expect((await c.fns.procs.migrate.status({})).find((m: any) => m.id === "002_b")!.applied).toBe(false);
});

test("migrate: down on a fresh DB is a no-op (no missing-table error)", async () => {
    const fresh = await scratch(); // own empty schema, never migrated
    expect((await fresh.fns.procs.migrate.down({})).rolledBack).toEqual([]);
});
