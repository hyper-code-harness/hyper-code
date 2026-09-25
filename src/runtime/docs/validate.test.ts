import { expect, test } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();

test("runtime docs validator accepts a well documented function", async () => {
    const report = await ctx.fns.runtime.docs.validate({ name: "agent.compact" });
    expect(report.ok).toBe(true);
    expect(report.checks.metadata).toBe(true);
    expect(report.checks.parameters).toBeGreaterThan(0);
});

test("runtime docs validator reports and throws structural errors", async () => {
    const fn: any = async () => null;
    fn.meta = { name: "quality.bad", rel: "quality/bad.ts", summary: "Bad", doc: "", optsType: "{ value: any }", returnType: "unknown", paramsSchema: { properties: { value: { description: "The value value used by the operation." } } } };
    (ctx.state.registry as any).quality = { bad: fn };
    const report = await ctx.fns.runtime.docs.validate({ name: "quality.bad" });
    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("summary");
    expect(report.errors.join(" ")).toContain("parameter value");
    expect(report.warnings.join(" ")).toContain("return type");
    await expect(ctx.fns.runtime.docs.validate({ name: "quality.bad", strict: true })).rejects.toThrow("runtime.docs.validate quality.bad");
});
