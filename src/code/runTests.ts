// One full `bun test` run in the background, writing the timings and JUnit
// report code.tests reads. Only one run at a time; the state lives in
// ctx.state.code.testRun so code.testRunStatus and the Tests canvas can poll it.

/**
 * Starts the full project test suite in the background (parallel, against the test Postgres) and records timings and a JUnit report in .runtime/ for code.tests.
 * Use to refresh the Tests canvas or check the suite after a change; returns at once — poll code.testRunStatus. A run already in progress is reused, not doubled.
 * @param opts.path Directory or file to test, relative to the project root. @default "src"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Directory or file to test, relative to the project root. @default "src" */
    path?: string;
}): Promise<{ running: boolean; startedAt?: number; exitCode?: number | null; started: boolean }> {
    const st = ((ctx.state as any).code ??= {}) as { testRun?: { running: boolean; startedAt: number; exitCode: number | null; path: string } };
    if (st.testRun?.running) return { ...st.testRun, started: false };
    const path = opts.path ?? "src";
    if (path.startsWith("-") || path.includes("..")) throw new Error("invalid test path: " + path);
    const ws = String((ctx.state as any).root);
    const run = { running: true, startedAt: Date.now(), exitCode: null as number | null, path };
    st.testRun = run;
    const p = Bun.spawn({
        cmd: ["bun", "test", "--parallel=16", "--no-isolate",
            "--timings=.runtime/test-timings.json", "--update-timings",
            "--reporter=junit", "--reporter-outfile=.runtime/test-report.xml", path],
        cwd: ws,
        stdout: Bun.file(ws + "/.runtime/test-run.log"),
        stderr: "pipe",
    });
    // bun writes the progress lines to stderr; keep them in the same log
    const log = Bun.file(ws + "/.runtime/test-run.log");
    void (async () => {
        const err = await new Response(p.stderr).text();
        run.exitCode = await p.exited;
        await Bun.write(log, (await log.text().catch(() => "")) + err);
        run.running = false;
    })().catch(() => { run.running = false; });
    return { ...run, started: true };
}
