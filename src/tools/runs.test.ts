// The running-call registry and the abort path.
//
// The behaviour under test is the one the UI depends on: while a tool runs it
// is visible with its streamed output, a stop request kills it promptly and
// yields an honest result, and nothing is left behind afterwards. A leaked
// entry would keep a spinner on screen forever, which is worse than the
// silence this feature replaced.
import { test, expect } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();

test("tools.runs exposes a running call, then forgets it", async () => {
    const before = ctx.fns.tools.runs({}).length;
    const call = ctx.fns.tools.call({ name: "bash", args: { command: "echo hello; sleep 5" } });
    await Bun.sleep(900);

    const live = ctx.fns.tools.runs({}).filter((r: any) => r.name === "bash");
    expect(live.length).toBe(1);
    // The tail is the proof of life: output is visible before the call ends.
    expect(live[0]!.tail).toContain("hello");

    ctx.fns.tools.abortRun({ id: live[0]!.id });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(result.output).toContain("stopped by the user");
    // What it managed to print is reported, so the model is not left guessing.
    expect(result.output).toContain("hello");

    expect(ctx.fns.tools.runs({}).filter((r: any) => r.name === "bash").length).toBe(0);
    expect(ctx.fns.tools.runs({}).length).toBe(before);
});

test("an aborted call returns far sooner than its command would have", async () => {
    const started = Date.now();
    const call = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 30" } });
    await Bun.sleep(600);
    const run = ctx.fns.tools.runs({}).find((r: any) => r.name === "bash");
    expect(run).toBeTruthy();
    ctx.fns.tools.abortRun({ id: run!.id });
    await call;
    // The process is killed, not merely abandoned.
    expect(Date.now() - started).toBeLessThan(10_000);
});

test("the longest-running call is reported first", async () => {
    const slow = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 6" } });
    await Bun.sleep(800);
    const quick = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 3" } });
    await Bun.sleep(400);

    // A user waiting on a long call must not be shown a short one instead.
    const first = ctx.fns.tools.runs({})[0];
    const slowest = ctx.fns.tools.runs({}).reduce((a: any, b: any) => (a.startedAt <= b.startedAt ? a : b));
    expect(first!.id).toBe(slowest.id);

    for (const r of ctx.fns.tools.runs({})) ctx.fns.tools.abortRun({ id: r.id });
    await Promise.all([slow, quick]);
});
