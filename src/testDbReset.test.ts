import { expect, test } from "bun:test";
import { testCtx } from "./$test";

// A migration's down() in one test must not leave the next tests of the process without the template's schema.
test("a test that drops a template column", async () => {
    const ctx = await testCtx();
    await ctx.fns.procs.db.exec({ sql: "ALTER TABLE canvas_items DROP COLUMN shown_at" });
});

test("the next test has the column back", async () => {
    const ctx = await testCtx();
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'canvas_items' AND column_name = 'shown_at'" });
    expect(rows).toHaveLength(1);
});

test("a test that drops a template table", async () => {
    const ctx = await testCtx();
    await ctx.fns.procs.db.exec({ sql: "DROP TABLE canvas_items CASCADE" });
});

test("the next test has the table back", async () => {
    const ctx = await testCtx();
    expect((await ctx.fns.procs.db.select({ sql: "SELECT to_regclass('public.canvas_items')::text AS t" }))[0].t).toBe("canvas_items");
});
