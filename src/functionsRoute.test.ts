import { test, expect } from "bun:test";
import { testCtx } from "./$test";
import route from "./$route_functions_GET";

const ctx = await testCtx();

test("GET /functions renders searchable live runtime documentation", async () => {
    const page: any = await route(ctx, null, {
        req: new Request("http://localhost/functions?q=watch+database+rows+wake+agent&namespace=agent"),
        params: {},
    });
    expect(page.title).toBe("functions: watch database rows wake agent");
    expect(page.main).toContain("Runtime functions");
    expect(page.main).toContain("agent.watch");
    expect(page.main).toContain("Target agent identifier.");
    expect(page.main).toContain("Promise&lt;{ id: string; nextAt: number; hint: string; timeoutAt: number | null }&gt;");
    expect(page.main).toContain("Signature");
    expect(page.main).toContain("class=\"shiki");
    expect(page.main).toContain("ctx.fns.agent.");
    expect(page.main).toContain(">watch<");
    expect(page.main).toContain("predicate:");
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
