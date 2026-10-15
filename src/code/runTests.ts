// One full `bun test` run in the background, writing the timings and JUnit
// report code.tests reads. Only one run at a time; the state lives in
// ctx.state.code.testRun so code.testRunStatus and the Tests canvas can poll it.
// bun prints "(pass) …" / "(fail) …" per test and "<file>:" per file on stderr;
// those lines are counted as they arrive, so the run's progress is visible
// against the size of the previous run.

/**
 * Starts the full project test suite in the background (parallel, against the test Postgres) and records timings and a JUnit report in .runtime/ for code.tests.
 * Use to refresh the Tests canvas or check the suite after a change; returns at once — poll code.testRunStatus for live counts. A run already in progress is reused, not doubled.
 * @param opts.path Directory or file to test, relative to the project root. @default "src"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Directory or file to test, relative to the project root. @default "src" */
    path?: string;
}): Promise<types.code.TestRun & { started: boolean }> {
    const st = ((ctx.state as any).code ??= {}) as { testRun?: types.code.TestRun };
    if (st.testRun?.running) return { ...(ctx.fns.code.testRunStatus({}) as types.code.TestRun), started: false };
    const path = opts.path ?? "src";
    if (path.startsWith("-") || path.includes("..")) throw new Error("invalid test path: " + path);
    const ws = String((ctx.state as any).root);

    // the size of the last run is the best guess of this one's
    let expected = 0, expectedFiles = 0;
    try {
        const xml = await Bun.file(ws + "/.runtime/test-report.xml").text();
        expected = +(xml.match(/<testsuites [^>]*tests="(\d+)"/)?.[1] ?? 0);
        expectedFiles = Object.keys(JSON.parse(await Bun.file(ws + "/.runtime/test-timings.json").text()).files ?? {}).length;
    } catch { /* first run: no estimate */ }

    const run: types.code.TestRun = { running: true, startedAt: Date.now(), exitCode: null, path, pass: 0, fail: 0, skip: 0, files: 0, expected, expectedFiles, failed: [], current: "" };
    st.testRun = run;
    const p = Bun.spawn({
        cmd: ["bun", "test", "--parallel=16", "--no-isolate",
            "--timings=.runtime/test-timings.json", "--update-timings",
            "--reporter=junit", "--reporter-outfile=.runtime/test-report.xml", path],
        cwd: ws, stdout: "pipe", stderr: "pipe",
    });
    const log = Bun.file(ws + "/.runtime/test-run.log").writer();
    const read = async (s: ReadableStream<Uint8Array>, count: boolean) => {
        const dec = new TextDecoder();
        let buf = "";
        for await (const chunk of s) {
            log.write(chunk);
            if (!count) continue;
            buf += dec.decode(chunk, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const l of lines) {
                if (l.startsWith("(pass)")) run.pass++;
                else if (l.startsWith("(fail)")) { run.fail++; run.failed.push(l.slice(7).replace(/ \[[\d.]+m?s\]$/, "")); if (run.failed.length > 200) run.failed.shift(); }
                else if (l.startsWith("(skip)") || l.startsWith("(todo)")) run.skip++;
                else if (/^\S.*\.test\.[jt]sx?:$/.test(l)) { run.files++; run.current = l.slice(0, -1); }
            }
        }
    };
    void (async () => {
        await Promise.all([read(p.stdout, false), read(p.stderr, true)]);
        run.exitCode = await p.exited;
        await log.end();
    })().catch(() => {}).finally(() => { run.running = false; run.finishedAt = Date.now(); });
    return { ...(ctx.fns.code.testRunStatus({}) as types.code.TestRun), started: true };
}
