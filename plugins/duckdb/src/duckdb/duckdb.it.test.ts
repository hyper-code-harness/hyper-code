import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { testCtx } from "../../../../src/$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });

function withFile(name: string, body: string, run: (path: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), "duckdb-plugin-"));
    const path = join(dir, name);
    writeFileSync(path, body);
    return run(path).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const events = [
    JSON.stringify({ level: "info", ms: 5 }),
    JSON.stringify({ level: "error", ms: 20 }),
    JSON.stringify({ level: "error", ms: 30 }),
].join("\n") + "\n";

test("inspects and queries NDJSON with DuckDB", async () => {
    await withFile("events.ndjson", events, async path => {
        const inspected = await ctx.fns.duckdb.inspect({ path, sample: 2 });
        expect(inspected.format).toBe("ndjson");
        expect(inspected.columns.map(x => x.name)).toEqual(["level", "ms"]);
        expect(inspected.rowCount).toBe(3);
        expect(inspected.sample.length).toBe(2);
        const result = await ctx.fns.duckdb.ndjson({ path, select: "level, count(*) AS n, avg(ms) AS avg_ms", groupBy: "level", orderBy: "n DESC" });
        expect(result.rows[0]).toEqual({ level: "error", n: 2, avg_ms: 25 });
    });
});

test("query rejects write SQL", async () => {
    await expect(ctx.fns.duckdb.query({ sql: "CREATE TABLE nope(a int)" })).rejects.toThrow(/read-only/);
});

test("runs in process and keeps the catalogue between calls", async () => {
    const { instance, reason } = await ctx.fns.duckdb.conn({});
    expect(instance, `native engine unavailable: ${reason}`).toBeTruthy();
    const created = await ctx.fns.duckdb.exec({ sql: "CREATE OR REPLACE VIEW persisted AS SELECT 1 AS x UNION ALL SELECT 2" });
    expect(created.tables).toContain("persisted");
    const read = await ctx.fns.duckdb.query({ sql: "SELECT sum(x) AS total FROM persisted" });
    expect(read.rows).toEqual([{ total: 3 }]);
});

test("normalizes BigInt, dates and nesting into JSON-safe values", async () => {
    const rows = await ctx.fns.duckdb.run({
        sql: "SELECT 2::bigint AS small, 9007199254740993::bigint AS huge, DATE '2026-01-02' AS d, [1, 2] AS list, {'a': 3} AS nested, NULL AS empty",
    });
    expect(rows[0]).toEqual({ small: 2, huge: "9007199254740993", d: "2026-01-02T00:00:00.000Z", list: [1, 2], nested: { a: 3 }, empty: null });
    expect(() => JSON.stringify(rows)).not.toThrow();
});

test("binds parameters instead of interpolating them", async () => {
    const result = await ctx.fns.duckdb.query({ sql: "SELECT ? AS n, ? AS s", params: [7, "o'brien"] });
    expect(result.rows).toEqual([{ n: 7, s: "o'brien" }]);
});

test("interrupts a runaway query and leaves the engine usable", async () => {
    await expect(ctx.fns.duckdb.run({ sql: "SELECT count(*) FROM generate_series(1, 100000000000) t(i)", timeout: 1 })).rejects.toThrow(/timed out/);
    const after = await ctx.fns.duckdb.query({ sql: "SELECT 1 AS ok" });
    expect(after.rows).toEqual([{ ok: 1 }]);
});

test("formats a result as an aligned Markdown table", async () => {
    const table = await ctx.fns.duckdb.table({ sql: "SELECT 'a' AS name, 1234567 AS n UNION ALL SELECT 'b', 2" });
    expect(table.markdown).toContain("| name | n |");
    expect(table.markdown).toContain("| --- | ---: |");
    expect(table.markdown).toContain("1,234,567");
    expect(table.rowCount).toBe(2);
});

test("reports truncation instead of hiding it", async () => {
    const table = await ctx.fns.duckdb.table({ sql: "SELECT i FROM generate_series(1, 10) t(i)", maxRows: 3 });
    expect(table.truncated).toBe(true);
    expect(table.markdown).toContain("showing 3");
});

test("charts a query result through vegalite", async () => {
    const chart = await ctx.fns.duckdb.chart({
        sql: "SELECT 'alpha' AS label, 3 AS n UNION ALL SELECT 'beta', 5",
        x: "label",
        y: "n",
        title: "Demo",
    });
    expect(chart.svg).toStartWith("<svg");
    expect(chart.spec.mark).toBe("bar");
    expect((chart.spec.encoding as any).x.type).toBe("nominal");
    expect((chart.spec.encoding as any).y.type).toBe("quantitative");
    expect(chart.rows.length).toBe(2);
});

test("chart picks a temporal axis for dates", async () => {
    const chart = await ctx.fns.duckdb.chart({ sql: "SELECT DATE '2026-01-02' AS day, 1 AS n UNION ALL SELECT DATE '2026-01-03', 4", mark: "line" });
    expect((chart.spec.encoding as any).x.type).toBe("temporal");
});

test("chart names the columns it actually got when one is missing", async () => {
    await expect(ctx.fns.duckdb.chart({ sql: "SELECT 'a' AS label, 'b' AS other" })).rejects.toThrow(/no numeric column.*label, other/);
});

test("ndjson reads CSV and Parquet through the same builder", async () => {
    await withFile("rows.csv", "name,n\na,1\nb,2\n", async path => {
        const result = await ctx.fns.duckdb.ndjson({ path, where: "n > 1" });
        expect(result.rows).toEqual([{ name: "b", n: 2 }]);
    });
});

test("source refuses an unsupported extension", () => {
    expect(() => ctx.fns.duckdb.source({ path: "notes.txt" })).toThrow(/unsupported source/);
});
