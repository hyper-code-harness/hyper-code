import { test, expect } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();

test("pgParams: array parameters become Postgres array literals", () => {
    expect(ctx.fns.procs.db.pgParams({ params: [["a", "b"]] })).toEqual(['{"a","b"}']);
    expect(ctx.fns.procs.db.pgParams({ params: [[1, 2]] })).toEqual(['{"1","2"}']);
    expect(ctx.fns.procs.db.pgParams({ params: [[]] })).toEqual(["{}"]);
});

test("pgParams: elements escape quotes and backslashes, NULL stays unquoted", () => {
    expect(ctx.fns.procs.db.pgParams({ params: [['he said "hi"', "back\\slash", null]] })).toEqual(['{"he said \\"hi\\"","back\\\\slash",NULL}']);
});

test("pgParams: scalar parameters pass through untouched", () => {
    const date = new Date(0);
    expect(ctx.fns.procs.db.pgParams({ params: ["plain", 7, null, date] })).toEqual(["plain", 7, null, date]);
    expect(ctx.fns.procs.db.pgParams({ params: "single" })).toEqual(["single"]);
    expect(ctx.fns.procs.db.pgParams({})).toEqual([]);
});

test("pgParams: ANY(?::text[]) selects by a JavaScript array", async () => {
    await ctx.fns.procs.db.exec({ sql: "CREATE TABLE pgp (id TEXT)" });
    await ctx.fns.procs.db.run({ sql: "INSERT INTO pgp (id) VALUES (?), (?), (?)", params: ["a", "b", "c"] });
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id FROM pgp WHERE id = ANY(?::text[]) ORDER BY id", params: [["a", "c"]] });
    expect(rows).toEqual([{ id: "a" }, { id: "c" }]);
});
