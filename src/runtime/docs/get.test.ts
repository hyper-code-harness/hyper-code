import { test, expect } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();

test("runtime.docs.get exposes JSDoc, types and parameter schema", () => {
    const meta = ctx.fns.runtime.docs.get({ name: "jev.decide" });
    expect(meta.summary).toContain("System One");
    expect(meta.returnType).toContain("latencyMs");
    expect(meta.paramsSchema.required).toContain("state");
    expect(meta.paramsSchema.required).toContain("questions");
    expect(meta.paramsSchema.properties.timeoutMs).toMatchObject({ type: "number", default: 8000 });
});

test("runtime.docs search is compact and list filters namespaces", async () => {
    const hits = await ctx.fns.runtime.docs.search({ query: "typed decision probability", mode: "lexical" });
    expect(hits.map((x: any) => x.name)).toContain("jev.decide");
    expect((hits[0] as any).paramsSchema).toBeUndefined();
    const listed = ctx.fns.runtime.docs.list({ namespace: "runtime.docs" });
    expect(listed.map((x: any) => x.name)).toEqual(["runtime.docs.get", "runtime.docs.index", "runtime.docs.list", "runtime.docs.ragBenchmark", "runtime.docs.ragCases", "runtime.docs.search", "runtime.docs.validate"]);
});
