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

// Poll instead of guessing how long a spawn takes: returns as soon as ok(value).
async function until<T>(fn: () => T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
    const end = Date.now() + ms;
    let v = fn();
    while (!ok(v) && Date.now() < end) { await Bun.sleep(10); v = fn(); }
    return v;
}
const bashRuns = () => ctx.fns.tools.runs({}).filter((r: any) => r.name === "bash");

test("tools.runs exposes a running call, then forgets it", async () => {
    const before = ctx.fns.tools.runs({}).length;
    const call = ctx.fns.tools.call({ name: "bash", args: { command: "echo hello; sleep 5" } });
    const live = await until(bashRuns, l => l.length === 1 && String(l[0]!.tail).includes("hello"));
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
    const run = (await until(bashRuns, l => l.length > 0))[0];
    expect(run).toBeTruthy();
    ctx.fns.tools.abortRun({ id: run!.id });
    await call;
    // The process is killed, not merely abandoned.
    expect(Date.now() - started).toBeLessThan(10_000);
});

test("the longest-running call is reported first", async () => {
    const slow = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 6" } });
    await until(bashRuns, l => l.length === 1);
    await Bun.sleep(20); // distinct startedAt
    const quick = ctx.fns.tools.call({ name: "bash", args: { command: "sleep 3" } });
    await until(bashRuns, l => l.length === 2);

    // A user waiting on a long call must not be shown a short one instead.
    const first = ctx.fns.tools.runs({})[0];
    const slowest = ctx.fns.tools.runs({}).reduce((a: any, b: any) => (a.startedAt <= b.startedAt ? a : b));
    expect(first!.id).toBe(slowest.id);

    for (const r of ctx.fns.tools.runs({})) ctx.fns.tools.abortRun({ id: r.id });
    await Promise.all([slow, quick]);
});
