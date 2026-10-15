import { test, expect } from "bun:test";
import { testCtx } from "./$test";
import route from "./$route_functions_GET";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });   // duckdb is an official plugin

test("GET /functions renders searchable live runtime documentation", async () => {
    const page: any = await route(ctx, null, {
        req: new Request("http://localhost/functions?q=read+only+duckdb+sql&namespace=duckdb"),
        params: {},
    });
    expect(page.title).toBe("functions: read only duckdb sql");
    expect(page.main).toContain("Runtime functions");
    expect(page.main).toContain("duckdb.query");
    expect(page.main).toContain("Read-only DuckDB SQL statement.");
    expect(page.main).toContain("Promise&lt;{ rows: any[]; rowCount: number; truncated: boolean }&gt;");
    expect(page.main).toContain("Signature");
    expect(page.main).toContain("class=\"shiki");
    expect(page.main).toContain("ctx.fns.duckdb.");
    expect(page.main).toContain(">query<");
    expect(page.main).toContain("sql: string;");
    expect(page.main).toContain("returns");
    expect(page.main).toContain("Search in English");
    expect(page.main).toContain("BM25");
    expect(page.main).toContain("bg-base-100");
    expect(page.main).toContain("text-base-content");
    expect(page.main).not.toContain("bg-white");
    expect(page.main).not.toContain("ui-button ui-button--primary");
});

test("functions page is present in the global navigation", async () => {
    const items = await ctx.fns.nav.items({ q: "functions", limit: 10 });
    expect(items).toContainEqual(expect.objectContaining({
        label: "functions",
        href: "/functions",
        hint: "page · searchable runtime API documentation",
        icon: "ph-function",
        group: "System",
        order: 20,
    }));
});
