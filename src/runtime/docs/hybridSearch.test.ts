import { beforeAll, expect, test } from "bun:test";
import { testCtx } from "../../$test";

// Official plugins mounted: the search cases below look for duckdb.* and telegram.*.
const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });

// The index is built once for the file; the tests only read it.
let first: Awaited<ReturnType<typeof ctx.fns.runtime.docs.index>>;
let before: any[];
beforeAll(async () => {
    await ctx.fns.settings.set({ module: "embeddings", scopeType: "global", key: "provider", value: "off" });
    first = await ctx.fns.runtime.docs.index({ localize: false });
    before = await ctx.fns.procs.db.select({ sql: "SELECT name, content_hash, updated_at FROM functions ORDER BY name", params: [] });
});

test("function index caches unchanged docs by content hash", async () => {
    const second = await ctx.fns.runtime.docs.index({ localize: false });
    const after = await ctx.fns.procs.db.select({ sql: "SELECT name, content_hash, updated_at FROM functions ORDER BY name", params: [] });
    expect(first.indexed).toBeGreaterThan(500);
    expect(second.embedded).toBe(0);
    expect(after).toEqual(before);   // updated_at included: an unchanged function is not rewritten at all
});

test("a changed function is rewritten, its unchanged neighbours are not", async () => {
    const name = before[0].name;
    await ctx.fns.procs.db.run({ sql: "UPDATE functions SET rel = 'stale/path.ts', updated_at = 0 WHERE name = ?", params: [name] });
    await ctx.fns.runtime.docs.index({ localize: false });
    const after: any[] = await ctx.fns.procs.db.select({ sql: "SELECT name, rel, updated_at FROM functions ORDER BY name", params: [] });
    expect(after[0].rel).not.toBe("stale/path.ts");
    expect(Number(after[0].updated_at)).toBeGreaterThan(0);
    expect(after.slice(1).map(r => [r.name, String(r.updated_at)])).toEqual(before.slice(1).map(r => [r.name, String(r.updated_at)]));
});

test("BM25 search and lexical fallback find the same intended function", async () => {
    const bm25 = await ctx.fns.runtime.docs.search({ query: "read only duckdb sql query", mode: "bm25", limit: 3 });
    const lexical = await ctx.fns.runtime.docs.search({ query: "read only duckdb sql query", mode: "lexical", limit: 3 });
    expect(bm25[0]?.name).toBe("duckdb.query");
    expect(lexical[0]?.name).toBe("duckdb.query");
    expect(bm25[0]?.bm25).toBeGreaterThan(0);
});

test("hybrid mode degrades to BM25 while embeddings are off", async () => {
    const hits = await ctx.fns.runtime.docs.search({ query: "send telegram message", mode: "hybrid", limit: 3 });
    expect(hits[0]?.name).toBe("telegram.send");
    expect(hits[0]?.similarity).toBeNull();
});
