import { describe, expect, test } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx({ env: { PROCS_PLUGINS: "./plugins" } });   // official plugins only, not this machine's user plugins

describe("generated plugin docs", () => {
    test("deduplicates mounted functions and exposes runtime metadata", () => {
        const result = ctx.fns.plugins.docs({ name: "arxiv" });
        expect(result.functions.map((fn: any) => fn.name)).toEqual([...new Set(result.functions.map((fn: any) => fn.name))]);
        const search = result.functions.find((fn: any) => fn.name === "arxiv.search");
        expect(search).toBeDefined();
        expect(search!.summary).toContain("Searches public arXiv");
        expect(search!.paramsSchema.properties.query).toBeDefined();
        expect(search!.returnType).toContain("SearchResult");
    });

    test("plugins.read combines overview with generated functions", async () => {
        const result = await ctx.fns.plugins.read({ name: "arxiv" });
        expect(result.overview.markdown).toContain("# arXiv");
        expect(result.functions.some((fn: any) => fn.name === "arxiv.download")).toBe(true);
    });
});
