import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkTestCtx } from "../_testCtx.entry";

test("code.tests reads timings + junit report; null without a run", async () => {
    const ctx: any = await mkTestCtx({ db: false });
    const root = join(tmpdir(), "hyper-code-tests-" + process.pid);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, ".runtime"), { recursive: true });
    mkdirSync(join(root, "src/m"), { recursive: true });
    ctx.state.root = root;
    expect(await ctx.fns.code.tests({})).toBeNull();
    writeFileSync(join(root, "src/m/a.test.ts"), 'test("slow one", () => {\n    expect(1).toBe(1);\n});\n');
    writeFileSync(join(root, ".runtime/test-report-fast.xml"), `<testsuites name="bun test" tests="2" assertions="2" failures="1" skipped="0" time="1.5">
<testsuite name="src/m/a.test.ts" file="src/m/a.test.ts" tests="2" failures="1" skipped="0" time="1.5">
<testcase name="slow one" classname="" time="1.2" file="m/a.test.ts" assertions="1" />
<testcase name="broken" classname="" time="0.1" file="m/a.test.ts" assertions="1">
<failure type="AssertionError" message="nope" />
</testcase></testsuite></testsuites>`);
    const r = await ctx.fns.code.tests({});
    expect(r).toMatchObject({ tests: 2, failures: 1, wall: 1.5, total: 1500, nfiles: 1 });
    expect(r.slowTests[0]).toMatchObject({ name: "slow one", s: 1.2 });
    expect(r.slowTests[0].code.line).toBe(1);
    expect(r.top[0].tests.length).toBe(2);
    expect(r.fails[0]).toMatchObject({ name: "broken", msg: "nope" });
    expect(ctx.fns.code.testRunStatus({})).toEqual({ running: false });
    // each kind has its own report: no integration run recorded yet
    expect(await ctx.fns.code.tests({ kind: "it" })).toBeNull();
    rmSync(root, { recursive: true, force: true });
});
