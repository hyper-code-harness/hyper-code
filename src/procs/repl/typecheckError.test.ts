// UNIT test: src/procs/repl/typecheckError.test.ts ↔ src/procs/repl/typecheckError.ts.
import { test, expect } from "bun:test";
import { testCtx } from "../../$test";

const ctx = await testCtx();

test("a failed eval typecheck names the real signature and source of the function it called wrong", async () => {
    const err = await ctx.fns.procs.repl.eval({
        code: `const x = 1;\nawait ctx.fns.session.load({ id: 123 })`,
        typecheck: true,
    }).then(() => null, (e: any) => String(e.message));
    expect(err).toContain("eval: typecheck failed:");
    expect(err).toContain("The real signature (trust it over any doc or example):");
    expect(err).toContain("ctx.fns.session.load(");
    expect(err).toMatch(/source: .*src\/session\/load\.ts/);
});

test("only functions on a failing line are explained; an unknown name adds nothing", () => {
    const text = ctx.fns.procs.repl.typecheckError({
        code: `await ctx.fns.session.list({})\nawait ctx.fns.nope.missing({ a: 1 })`,
        errors: ["2:14 Property 'nope' does not exist"],
    });
    expect(text).toBe("eval: typecheck failed:\n  2:14 Property 'nope' does not exist");
});
