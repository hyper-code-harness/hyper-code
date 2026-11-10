// FUNCTIONAL test: src/db.test.ts ↔ src/db/ namespace — Postgres via Bun.SQL,
// fully async. Under NODE_ENV=test the pool is one connection to the test
// process's copy of the migrated template, reset between tests (src/_testDb.entry.ts).
import { test, expect } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();

test("db: test env resolves to a Postgres url", () => {
    expect(ctx.fns.procs.db.url()).toStartWith("postgres://");
});

test("db: exec / run / select round-trip", async () => {
    await ctx.fns.procs.db.exec({ sql: "CREATE TABLE t (id SERIAL PRIMARY KEY, v TEXT)" });
    const r = await ctx.fns.procs.db.run({ sql: "INSERT INTO t (v) VALUES (?)", params: ["hello"] });
    expect(r.changes).toBe(1);
    expect(r.lastInsertRowid).toBe(0); // no rowid in pg — use db.insert / RETURNING
    expect(await ctx.fns.procs.db.select({ sql: "SELECT v FROM t" })).toEqual([{ v: "hello" }]);
});

test("db.run: RETURNING rows come through", async () => {
    const r = await ctx.fns.procs.db.run({ sql: "INSERT INTO t (v) VALUES (?) RETURNING id", params: ["again"] });
    expect(r.rows.length).toBe(1);
    expect(Number((r.rows[0] as any).id)).toBeGreaterThan(0);
});

test("db.sql: compiles the query DSL (parameterized)", () => {
    expect(ctx.fns.procs.db.sql({ select: ["id", "title"], from: "t", where: { done: 0, id: [1, 2] }, orderBy: "id", limit: 5 }))
        .toEqual({ sql: "SELECT id, title FROM t WHERE done = ? AND id IN (?, ?) ORDER BY id LIMIT 5", params: [0, 1, 2] });
});

test("db.sql: operator object — multiple ops AND-join, {} is a no-op", () => {
    expect(ctx.fns.procs.db.sql({ from: "t", where: { age: { ">": 1, "<": 10 } } }))
        .toEqual({ sql: "SELECT * FROM t WHERE age > ? AND age < ?", params: [1, 10] });
    expect(ctx.fns.procs.db.sql({ from: "t", where: { age: {} } }))
        .toEqual({ sql: "SELECT * FROM t", params: [] });
});

test("db.insert + db.q: round-trip through the DSL", async () => {
    await ctx.fns.procs.db.exec({ sql: "CREATE TABLE notes (id SERIAL PRIMARY KEY, body TEXT, done INTEGER)" });
    const first = await ctx.fns.procs.db.insert({ into: "notes", values: { body: "hi", done: 0 } });
    expect(Number(first.id)).toBe(1);
    expect(first.changes).toBe(1);
    await ctx.fns.procs.db.insert({ into: "notes", values: { body: "yo", done: 1 } });
    expect(await ctx.fns.procs.db.q({ select: "body", from: "notes", where: { done: 0 } })).toEqual([{ body: "hi" }]);
});

test("db lives in ctx → env.fork gives its own pool and connection (temp tables stay private)", async () => {
    const a = ctx.fns.procs.env.fork({ mode: "test" });
    const b = ctx.fns.procs.env.fork({ mode: "test" });
    // The test database is one copy per process; what a connection owns alone is its pg_temp.
    await a.fns.procs.db.exec({ sql: "CREATE TEMP TABLE x (n INTEGER)" });
    await a.fns.procs.db.run({ sql: "INSERT INTO x VALUES (1)" });
    await b.fns.procs.db.exec({ sql: "CREATE TEMP TABLE x (n INTEGER)" });   // b has its OWN connection
    expect(await b.fns.procs.db.select({ sql: "SELECT count(*)::int AS c FROM x" })).toEqual([{ c: 0 }]);
    expect(await a.fns.procs.db.select({ sql: "SELECT count(*)::int AS c FROM x" })).toEqual([{ c: 1 }]);
});
