// Test kinds are in the file name (*.test.ts fast, *.it.test.ts integration, *.live.test.ts live) —
// script/test.ts lists them, AGENTS.md "Test kinds" explains them.
//
// One `bun test` run in the background, writing the timings and JUnit
// report code.tests reads. Only one run at a time; the state lives in
// ctx.state.code.testRun so code.testRunStatus and the Tests canvas can poll it.
// bun prints "(pass) …" / "(fail) …" per test and "<file>:" per file on stderr;
// those lines are counted as they arrive, so the run's progress is visible
// against the size of the previous run.

/**
 * Starts the full project test suite in the background (parallel, against the test Postgres) and records timings and a JUnit report in .runtime/ for code.tests.
 * Use to refresh the Tests canvas or check the suite after a change; returns at once — poll code.testRunStatus for live counts. A run already in progress is reused, not doubled.
 * kind picks the files by name: "fast" (*.test.ts, the default), "it" (*.it.test.ts), "live" (*.live.test.ts), "all" (fast + it, never live).
 * @param opts.kind Which tests to run. @default "fast"
 * @param opts.path Directories or files to test, relative to the project root. @default ["src", "plugins", "script"]
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Which tests to run: fast (*.test.ts), it (*.it.test.ts, real processes), live (*.live.test.ts, network), all (fast + it). @default "fast" */
    kind?: types.code.TestKind;
    /** Directories or files to test, relative to the project root. @default ["src", "plugins", "script"] */
    path?: string | string[];
}): Promise<types.code.TestRun & { started: boolean }> {
    const st = ((ctx.state as any).code ??= {}) as { testRun?: types.code.TestRun };
    if (st.testRun?.running) return { ...(ctx.fns.code.testRunStatus({}) as types.code.TestRun), started: false };
    const kind: types.code.TestKind = opts.kind ?? "fast";
    if (!["fast", "it", "live", "all"].includes(kind)) throw new Error("invalid test kind: " + kind);
    const paths = [opts.path ?? ["src", "plugins", "script"]].flat();
    for (const x of paths) if (!x || x.startsWith("-") || x.includes("..")) throw new Error("invalid test path: " + x);
    const path = paths.join(" ");
    const ws = String((ctx.state as any).root);

    // the size of the last run is the best guess of this one's
    let expected = 0, expectedFiles = 0;
    try {
        const xml = await Bun.file(`${ws}/.runtime/test-report-${kind}.xml`).text();
        expected = +(xml.match(/<testsuites [^>]*tests="(\d+)"/)?.[1] ?? 0);
        expectedFiles = (xml.match(/<testsuite name=/g) ?? []).length;
    } catch { /* first run of this kind: no estimate */ }

    const run: types.code.TestRun = { running: true, startedAt: Date.now(), exitCode: null, kind, path, pass: 0, fail: 0, skip: 0, files: 0, expected, expectedFiles, failed: [], current: "" };
    st.testRun = run;
    const p = Bun.spawn({
        // script/test.ts picks the files of the kind (the same script `bun run test:<kind>` runs)
        cmd: ["bun", "script/test.ts", kind,
            "--timings=.runtime/test-timings.json", "--update-timings",
            "--reporter=junit", `--reporter-outfile=.runtime/test-report-${kind}.xml`, ...paths],
        cwd: ws, stdout: "pipe", stderr: "pipe",
    });
    const log = Bun.file(`${ws}/.runtime/test-run-${kind}.log`).writer();
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
